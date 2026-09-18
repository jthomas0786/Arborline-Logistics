import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import { enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";
import {
  ensureNationalMarketCatalog,
  getNationalCoordinatorSummary,
  planMarketSegments
} from "@/lib/connect-national-research";
import { runNativeContactEnrichment } from "@/lib/connect-native-enrichment";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { researchPublicCompanySite } from "@/lib/connect-public-research";
import {
  prepareConnectPreVerificationDrafts,
  promotePreparedOutreachDrafts
} from "@/lib/connect-outreach-drafts";

export type NationalWorkerType = "COORDINATE" | "RESEARCH" | "NATIVE_ENRICH" | "PROVIDER_ENRICH";

type NationalJob = {
  id: string;
  client_id: string | null;
  worker_type: NationalWorkerType;
  mode: "DRY_RUN" | "ACTIVE";
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
  segment_id: string | null;
  market_id: string | null;
};

class NationalWorkerBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NationalWorkerBlockedError";
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function nationalResearchEnabled() {
  return process.env.CONNECT_NATIONAL_RESEARCH_ENABLED !== "false";
}

function providerFallbackEnabled() {
  return process.env.CONNECT_NATIONAL_PROVIDER_FALLBACK_ENABLED === "true" &&
    process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED === "true";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

async function queueNationalJob(input: {
  clientId: string;
  workerType: NationalWorkerType;
  segmentId?: string | null;
  marketId?: string | null;
  priority?: number;
  limit?: number;
  mode?: "DRY_RUN" | "ACTIVE";
}) {
  const pool = getPool();
  const segmentId = input.segmentId ?? null;
  const marketId = input.marketId ?? null;

  const active = await pool.query(
    `SELECT id,status
     FROM connect_worker_jobs
     WHERE client_id=$1
       AND worker_type=$2
       AND segment_id IS NOT DISTINCT FROM $3::uuid
       AND market_id IS NOT DISTINCT FROM $4::uuid
       AND status IN ('QUEUED','RUNNING','RETRY')
     ORDER BY created_at ASC
     LIMIT 1`,
    [input.clientId, input.workerType, segmentId, marketId]
  );
  if (active.rows[0]) {
    const requestedPriority = clamp(input.priority, 1, 1000, 100);
    await pool.query(
      `UPDATE connect_worker_jobs
       SET priority=LEAST(priority,$2),
           run_at=LEAST(run_at,now()),
           updated_at=now()
       WHERE id=$1 AND status IN ('QUEUED','RUNNING','RETRY')`,
      [active.rows[0].id, requestedPriority]
    );
    return { id: active.rows[0].id, status: active.rows[0].status, created: false };
  }

  const window = Math.floor(Date.now() / (15 * 60_000));
  const key = [
    "connect-national",
    input.workerType.toLowerCase(),
    input.clientId,
    marketId ?? "all-markets",
    segmentId ?? "all-segments",
    String(window)
  ].join(":");
  const payload = {
    national: true,
    limit: clamp(input.limit, 1, 25, input.workerType === "PROVIDER_ENRICH" ? 5 : 10),
    ...(segmentId ? { segment_id: segmentId } : {}),
    ...(marketId ? { market_id: marketId } : {})
  };

  const inserted = await pool.query(
    `INSERT INTO connect_worker_jobs
       (client_id,worker_type,mode,status,priority,run_at,max_attempts,idempotency_key,payload,segment_id,market_id)
     VALUES ($1,$2,$3,'QUEUED',$4,now(),5,$5,$6::jsonb,$7,$8)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id,status`,
    [
      input.clientId,
      input.workerType,
      input.mode ?? "ACTIVE",
      clamp(input.priority, 1, 1000, 100),
      key,
      JSON.stringify(payload),
      segmentId,
      marketId
    ]
  );
  if (inserted.rows[0]) return { ...inserted.rows[0], created: true };

  const existing = await pool.query(
    `SELECT id,status FROM connect_worker_jobs WHERE idempotency_key=$1 LIMIT 1`,
    [key]
  );
  return { ...existing.rows[0], created: false };
}

export async function coordinateNationalResearch(clientId: string) {
  if (!nationalResearchEnabled()) {
    return {
      enabled: false,
      reason: "CONNECT_NATIONAL_RESEARCH_ENABLED=false",
      researchQueued: 0,
      nativeQueued: 0,
      providerQueued: 0
    };
  }

  const catalog = await ensureNationalMarketCatalog();
  const planning = await planMarketSegments(clientId);
  const pool = getPool();
  const promotedPrepared = await promotePreparedOutreachDrafts(clientId, 50);
  const preparedBackfill = await prepareConnectPreVerificationDrafts(clientId, 50);
  const { rows: benchmarkSegments } = await pool.query(
    `SELECT s.id AS segment_id,
       count(p.id) FILTER (
         WHERE p.domain IS NOT NULL
           AND (p.contact_email IS NULL OR p.contact_name IS NULL)
           AND coalesce(p.source_metadata->'service_fit'->>'status','UNVERIFIED') <> 'MISMATCH'
           AND coalesce(p.source_metadata->>'research_benchmark_version','') <> '2'
       )::int AS benchmark_backlog
     FROM connect_prospect_segments s
     LEFT JOIN connect_prospects p ON p.client_id=s.client_id AND p.segment_id=s.id
     WHERE s.client_id=$1 AND s.status IN ('APPROVED','ACTIVE')
     GROUP BY s.id`,
    [clientId]
  );
  let benchmarkQueued = 0;
  let benchmarkBacklog = 0;
  for (const segment of benchmarkSegments) {
    const backlog = Number(segment.benchmark_backlog ?? 0);
    benchmarkBacklog += backlog;
    if (backlog <= 0) continue;
    const queued = await queueNationalJob({
      clientId,
      workerType: "RESEARCH",
      segmentId: String(segment.segment_id),
      marketId: null,
      priority: 1,
      // Benchmark reruns are intentionally a little wider than ordinary market
      // research. Eight stayed comfortably below the 240-second worker ceiling
      // in the live five-prospect timing sample while materially improving
      // national catch-up throughput.
      limit: 8
    });
    if (queued.created) benchmarkQueued++;
  }

  const { rows: cells } = await pool.query(
    `SELECT
       ms.market_id,ms.segment_id,ms.priority,
       count(p.id) FILTER (
         WHERE p.contact_email IS NULL
           AND p.domain IS NOT NULL
           AND (
             p.qualification_status='QUALIFIED'
             OR (p.qualification_status='REVIEW' AND coalesce(p.qualification_score,0)>=60 AND p.source='ARBORLINE_DISCOVERY')
             OR (p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','')='')
           )
           AND (
             NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
             OR (p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','')='')
             OR (
               p.source='ARBORLINE_DISCOVERY'
               AND p.qualification_status='REVIEW'
               AND p.source_metadata->'service_fit'->>'status'='MATCH'
               AND p.contact_name IS NULL
               AND coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')=''
             )
           )
       )::int AS research_backlog,
       count(p.id) FILTER (
         WHERE p.contact_email IS NULL
           AND p.domain IS NOT NULL
           AND p.source='ARBORLINE_DISCOVERY'
           AND p.qualification_status='REVIEW'
           AND p.source_metadata->'service_fit'->>'status'='MATCH'
           AND p.contact_name IS NULL
           AND coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')=''
       )::int AS acceleration_backlog
     FROM connect_market_segments ms
     JOIN connect_research_markets m ON m.id=ms.market_id
     JOIN connect_prospect_segments s ON s.id=ms.segment_id
     LEFT JOIN connect_prospects p
       ON p.client_id=ms.client_id AND p.market_id=ms.market_id AND p.segment_id=ms.segment_id
     WHERE ms.client_id=$1
       AND ms.status='ACTIVE'
       AND m.status='ACTIVE'
       AND s.status IN ('APPROVED','ACTIVE')
     GROUP BY ms.market_id,ms.segment_id,ms.priority
     ORDER BY ms.priority ASC`,
    [clientId]
  );

  let researchQueued = 0;
  for (const cell of cells) {
    if (Number(cell.research_backlog ?? 0) <= 0) continue;
    const baseResearchPriority = Math.max(
      1,
      Number(cell.priority ?? 100) - (Number(cell.acceleration_backlog ?? 0) > 0 ? 25 : 0)
    );
    const queued = await queueNationalJob({
      clientId,
      workerType: "RESEARCH",
      segmentId: String(cell.segment_id),
      marketId: String(cell.market_id),
      // Segment-wide benchmark jobs use priority 1. While that backlog exists,
      // keep ordinary market research below them so older FIFO work cannot starve
      // the benchmark rerun on every coordinator pass.
      priority: benchmarkBacklog > 0 ? Math.max(10, baseResearchPriority) : baseResearchPriority,
      limit: 5
    });
    if (queued.created) researchQueued++;
  }

  const { rows: segmentBacklogs } = await pool.query(
    `SELECT
       p.segment_id,
       min(ms.priority)::int AS priority,
       count(*) FILTER (
         WHERE p.qualification_status='QUALIFIED'
           AND p.suppression_status='CLEAR'
           AND p.contact_email IS NULL
           AND p.contact_name IS NOT NULL
           AND public.connect_contact_name_is_personlike(p.contact_name)
           AND p.domain IS NOT NULL
           AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
           AND (
             coalesce(p.source_metadata->'native_contact_enrichment'->>'checked_at','')=''
             OR (
               EXISTS (
                 SELECT 1 FROM connect_prepared_outreach_drafts pd
                 WHERE pd.prospect_id=p.id AND pd.status='PREPARED'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM connect_contact_candidates cc
                 WHERE cc.prospect_id=p.id
                   AND lower(cc.contact_name)=lower(p.contact_name)
               )
             )
           )
       )::int AS native_backlog,
       count(*) FILTER (
         WHERE p.qualification_status='QUALIFIED'
           AND p.suppression_status='CLEAR'
           AND p.contact_email IS NULL
           AND p.contact_name IS NOT NULL
           AND public.connect_contact_name_is_personlike(p.contact_name)
           AND EXISTS (
             SELECT 1 FROM connect_prepared_outreach_drafts pd
             WHERE pd.prospect_id=p.id AND pd.status='PREPARED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_contact_candidates cc
             WHERE cc.prospect_id=p.id
               AND lower(cc.contact_name)=lower(p.contact_name)
           )
       )::int AS prepared_native_backlog,
       count(*) FILTER (
         WHERE p.qualification_status='QUALIFIED'
           AND p.suppression_status='CLEAR'
           AND p.contact_email IS NULL
           AND p.domain IS NOT NULL
           AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
           AND coalesce(p.source_metadata->'native_contact_enrichment'->>'provider_fallback_recommended','false')='true'
       )::int AS provider_backlog
     FROM connect_prospects p
     JOIN connect_market_segments ms
       ON ms.client_id=p.client_id AND ms.market_id=p.market_id AND ms.segment_id=p.segment_id AND ms.status='ACTIVE'
     JOIN connect_research_markets m ON m.id=p.market_id AND m.status='ACTIVE'
     WHERE p.client_id=$1 AND p.segment_id IS NOT NULL
     GROUP BY p.segment_id`,
    [clientId]
  );

  let nativeQueued = 0;
  let providerQueued = 0;
  let providerWaiting = 0;
  for (const segment of segmentBacklogs) {
    const segmentId = String(segment.segment_id);
    if (Number(segment.native_backlog ?? 0) > 0) {
      const queued = await queueNationalJob({
        clientId,
        workerType: "NATIVE_ENRICH",
        segmentId,
        priority: Math.max(1, Number(segment.priority ?? 100) + 5 - (Number(segment.prepared_native_backlog ?? 0) > 0 ? 30 : 0)),
        limit: 20
      });
      if (queued.created) nativeQueued++;
    }

    if (Number(segment.provider_backlog ?? 0) > 0) {
      if (providerFallbackEnabled()) {
        const queued = await queueNationalJob({
          clientId,
          workerType: "PROVIDER_ENRICH",
          segmentId,
          priority: Number(segment.priority ?? 100) + 20,
          limit: 5
        });
        if (queued.created) providerQueued++;
      } else {
        providerWaiting += Number(segment.provider_backlog ?? 0);
      }
    }
  }

  return {
    enabled: true,
    catalog,
    planning,
    activeCells: cells.length,
    benchmarkQueued,
    benchmarkBacklog,
    researchQueued,
    nativeQueued,
    providerQueued,
    providerWaiting,
    providerFallbackEnabled: providerFallbackEnabled(),
    preparedDrafts: {
      promoted: promotedPrepared.preparedDraftsPromoted,
      created: preparedBackfill.preparedDraftsCreated
    },
    summary: await getNationalCoordinatorSummary(clientId)
  };
}

async function researchMarketCell(job: NationalJob) {
  if (!job.client_id || !job.segment_id) {
    throw new NationalWorkerBlockedError("Research jobs require client and segment scope.");
  }
  const pool = getPool();
  const benchmarkMode = !job.market_id;
  const scope = benchmarkMode
    ? await pool.query(
      `SELECT s.*,'all-markets'::text AS market_slug,'All unresolved prospects'::text AS market_name
       FROM connect_prospect_segments s
       WHERE s.id=$2 AND s.client_id=$1 AND s.status IN ('APPROVED','ACTIVE')
       LIMIT 1`,
      [job.client_id, job.segment_id]
    )
    : await pool.query(
      `SELECT s.*,m.slug AS market_slug,m.name AS market_name
       FROM connect_market_segments ms
       JOIN connect_prospect_segments s ON s.id=ms.segment_id AND s.client_id=ms.client_id
       JOIN connect_research_markets m ON m.id=ms.market_id
       WHERE ms.client_id=$1 AND ms.segment_id=$2 AND ms.market_id=$3
         AND ms.status='ACTIVE' AND m.status='ACTIVE' AND s.status IN ('APPROVED','ACTIVE')
       LIMIT 1`,
      [job.client_id, job.segment_id, job.market_id]
    );
  const segment = scope.rows[0];
  if (!segment) throw new NationalWorkerBlockedError(benchmarkMode ? "Benchmark segment is no longer active." : "Market/segment cell is no longer active.");

  const titles = asStringArray(segment.decision_maker_titles);
  if (!titles.length) throw new NationalWorkerBlockedError("Segment has no approved decision-maker titles.");
  const limit = clamp(
    job.payload?.limit,
    1,
    benchmarkMode ? 8 : 5,
    benchmarkMode ? 8 : 5
  );
  const { rows } = benchmarkMode
    ? await pool.query(
      `SELECT p.*,
         false AS is_qualification_acceleration,
         EXISTS (
           SELECT 1 FROM connect_suppressions sup
           WHERE (sup.client_id IS NULL OR sup.client_id=p.client_id)
             AND ((sup.email IS NOT NULL AND lower(sup.email)=lower(p.contact_email))
               OR (sup.domain IS NOT NULL AND lower(sup.domain)=lower(p.domain)))
         ) AS is_suppressed
       FROM connect_prospects p
       WHERE p.client_id=$1 AND p.segment_id=$2
         AND p.domain IS NOT NULL
         AND (p.contact_email IS NULL OR p.contact_name IS NULL)
         AND coalesce(p.source_metadata->'service_fit'->>'status','UNVERIFIED') <> 'MISMATCH'
         AND coalesce(p.source_metadata->>'research_benchmark_version','') <> '2'
       ORDER BY CASE
         WHEN p.qualification_status='QUALIFIED' THEN 0
         WHEN p.source_metadata->'service_fit'->>'status'='MATCH' THEN 1
         WHEN p.qualification_status='REVIEW' THEN 2
         ELSE 3
       END,p.qualification_score DESC NULLS LAST,p.updated_at DESC
       LIMIT $3`,
      [job.client_id, job.segment_id, limit]
    )
    : await pool.query(
      `SELECT p.*,
         (
           p.source='ARBORLINE_DISCOVERY'
           AND p.qualification_status='REVIEW'
           AND p.source_metadata->'service_fit'->>'status'='MATCH'
           AND p.contact_name IS NULL
           AND (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
           AND coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')=''
         ) AS is_qualification_acceleration,
         EXISTS (
           SELECT 1 FROM connect_suppressions sup
           WHERE (sup.client_id IS NULL OR sup.client_id=p.client_id)
             AND ((sup.email IS NOT NULL AND lower(sup.email)=lower(p.contact_email))
               OR (sup.domain IS NOT NULL AND lower(sup.domain)=lower(p.domain)))
         ) AS is_suppressed
       FROM connect_prospects p
       WHERE p.client_id=$1 AND p.segment_id=$2 AND p.market_id=$3
         AND p.contact_email IS NULL
         AND p.domain IS NOT NULL
         AND (
           p.qualification_status='QUALIFIED'
           OR (p.qualification_status='REVIEW' AND coalesce(p.qualification_score,0)>=60 AND p.source='ARBORLINE_DISCOVERY')
           OR (p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','')='')
         )
         AND (
           NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
           OR (p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','')='')
           OR (
             p.source='ARBORLINE_DISCOVERY'
             AND p.qualification_status='REVIEW'
             AND p.source_metadata->'service_fit'->>'status'='MATCH'
             AND p.contact_name IS NULL
             AND coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')=''
           )
         )
       ORDER BY CASE
         WHEN p.source='ARBORLINE_DISCOVERY'
          AND p.qualification_status='REVIEW'
          AND p.source_metadata->'service_fit'->>'status'='MATCH'
          AND p.contact_name IS NULL
          AND coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')=''
         THEN 0
         WHEN p.qualification_status='QUALIFIED' THEN 1
         WHEN p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','')='' THEN 2
         ELSE 3
       END,
       coalesce((p.source_metadata->'public_research'->>'decision_maker_confidence')::int,0) DESC,
       p.qualification_score DESC NULLS LAST,p.created_at ASC
       LIMIT $4`,
      [job.client_id, job.segment_id, job.market_id, limit]
    );

  const profile: ConnectIcpProfile = {
    target_industries: asStringArray(segment.target_industries),
    target_geographies: asStringArray(segment.target_geographies),
    min_employees: segment.min_employees,
    max_employees: segment.max_employees,
    min_locations: segment.min_locations,
    max_locations: segment.max_locations,
    facility_types: asStringArray(segment.facility_types),
    decision_maker_titles: titles,
    buying_signals: asStringArray(segment.buying_signals),
    exclusions: asStringArray(segment.exclusions),
    minimum_score: Number(segment.minimum_score ?? 70)
  };

  const counts = {
    attempted: 0,
    candidates: 0,
    highConfidenceCandidates: 0,
    serviceFitMatch: 0,
    serviceFitReview: 0,
    serviceFitMismatch: 0,
    qualified: 0,
    blocked: 0,
    errors: 0
  };

  for (const row of rows) {
    counts.attempted++;
    const result = await researchPublicCompanySite(
      String(row.domain),
      titles,
      String(segment.slug ?? ""),
      profile.target_industries,
      { expanded: benchmarkMode || Boolean(row.is_qualification_acceleration), includePublicProfiles: benchmarkMode || Boolean(row.is_qualification_acceleration) }
    );
    if (result.status === "BLOCKED") counts.blocked++;
    if (result.status === "ERROR") counts.errors++;
    if (result.candidate) counts.candidates++;
    if (result.candidate?.confidenceGrade === "HIGH") counts.highConfidenceCandidates++;
    if (result.serviceFit?.status === "MATCH") counts.serviceFitMatch++;
    else if (result.serviceFit?.status === "REVIEW") counts.serviceFitReview++;
    else if (result.serviceFit?.status === "MISMATCH") counts.serviceFitMismatch++;

    const checkedAt = new Date().toISOString();
    const candidate = result.candidate;
    const metadata = {
      public_research_checked_at: checkedAt,
      ...(benchmarkMode ? { research_benchmark_version: "2", research_benchmark_checked_at: checkedAt } : {}),
      ...(row.is_qualification_acceleration ? { qualification_acceleration_checked_at: checkedAt } : {}),
      service_fit_checked_at: checkedAt,
      service_fit: result.serviceFit ?? {
        status: "UNVERIFIED",
        matchedTerms: [],
        commercialSignals: [],
        mismatchSignals: [],
        pagesMatched: [],
        evidence: ["Service fit was not available for this research result."]
      },
      public_research: {
        status: result.status,
        research_mode: benchmarkMode ? "PUBLIC_PROFILE_BENCHMARK_V2" : row.is_qualification_acceleration ? "QUALIFICATION_ACCELERATION" : "STANDARD",
        domain: result.domain,
        decision_maker_name: candidate?.name ?? null,
        decision_maker_title: candidate?.title ?? null,
        decision_maker_confidence: candidate?.decisionMakerConfidence ?? 0,
        decision_maker_confidence_grade: candidate?.confidenceGrade ?? "LOW",
        decision_maker_corroborating_pages: candidate?.corroboratingPages ?? 0,
        decision_maker_proximity: candidate?.proximity ?? null,
        decision_maker_source_kind: candidate?.sourceKind ?? null,
        published_email: candidate?.publishedEmail ?? null,
        email_status: candidate?.publishedEmail
          ? "PUBLISHED_UNVERIFIED"
          : candidate?.inferredEmailCandidates.length
            ? "INFERRED_UNVERIFIED"
            : "NONE",
        email_confidence: candidate?.emailConfidence ?? 0,
        inferred_email_candidates: candidate?.inferredEmailCandidates ?? [],
        published_company_emails: result.publishedEmails.slice(0, 12),
        source_url: candidate?.sourceUrl ?? null,
        pages_checked: result.pagesChecked.slice(0, benchmarkMode ? 15 : 7),
        evidence: candidate?.evidence ?? [],
        robots_respected: result.robotsRespected,
        error: result.error ?? null,
        market_id: job.market_id,
        market_slug: String(segment.market_slug ?? "")
      }
    };

    const canPersistIdentity = Boolean(
      candidate?.name &&
      candidate?.title &&
      candidate.decisionMakerConfidence >= 85 &&
      (row.source !== "ARBORLINE_DISCOVERY" || result.serviceFit?.status === "MATCH")
    );
    await pool.query(
      `UPDATE connect_prospects
       SET contact_name=CASE WHEN contact_name IS NULL AND $2::boolean THEN $3 ELSE contact_name END,
           contact_title=CASE WHEN contact_title IS NULL AND $2::boolean THEN $4 ELSE contact_title END,
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
           updated_at=now()
       WHERE id=$1`,
      [row.id, canPersistIdentity, candidate?.name ?? null, candidate?.title ?? null, JSON.stringify(metadata)]
    );

    const suppression = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
    const scored = scoreConnectProspect({
      company_name: row.company_name,
      domain: row.domain,
      industry: row.industry,
      industry_fit_status: row.source === "ARBORLINE_DISCOVERY" ? (result.serviceFit?.status ?? "UNVERIFIED") : null,
      city: row.city,
      state: row.state,
      country: row.country,
      employee_count: row.employee_count,
      location_count: row.location_count,
      facility_type: row.facility_type,
      contact_title: canPersistIdentity ? (candidate?.title ?? row.contact_title) : row.contact_title,
      buying_signals: row.buying_signals,
      suppression_status: suppression
    }, profile);

    await pool.query(
      `UPDATE connect_prospects
       SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,
           suppression_status=$5,outreach_status=CASE WHEN $3='SUPPRESSED' THEN 'STOPPED' ELSE 'NOT_READY' END,
           last_scored_at=now(),updated_at=now()
       WHERE id=$1`,
      [row.id, scored.score, scored.status, JSON.stringify(scored.reasons), suppression]
    );
    if (scored.status === "QUALIFIED") counts.qualified++;
  }

  if (job.market_id) {
    await pool.query(
      `UPDATE connect_market_segments
       SET last_research_at=now(),updated_at=now(),
           metadata=metadata || $4::jsonb
       WHERE client_id=$1 AND segment_id=$2 AND market_id=$3`,
      [job.client_id, job.segment_id, job.market_id, JSON.stringify({
        last_research_worker_at: new Date().toISOString(),
        last_research_worker_attempted: counts.attempted
      })]
    );
  }

  const prepared = await prepareConnectPreVerificationDrafts(job.client_id, 50, job.segment_id);

  return {
    provider: "ARBORLINE_RESEARCH",
    marketId: job.market_id,
    segmentId: job.segment_id,
    market: String(segment.market_name ?? ""),
    segment: String(segment.name ?? ""),
    ...counts,
    preparedDraftsCreated: prepared.preparedDraftsCreated,
    contactsPromoted: 0,
    messagesSent: 0
  };
}

async function executeNationalJob(job: NationalJob) {
  if (job.worker_type === "COORDINATE") {
    if (!job.client_id) throw new NationalWorkerBlockedError("Coordinator job requires a client.");
    return coordinateNationalResearch(job.client_id);
  }
  if (job.mode !== "ACTIVE") {
    return { dryRun: true, type: job.worker_type, segmentId: job.segment_id, marketId: job.market_id };
  }
  if (!nationalResearchEnabled()) throw new NationalWorkerBlockedError("National research is disabled.");

  if (job.worker_type === "RESEARCH") return researchMarketCell(job);
  if (job.worker_type === "NATIVE_ENRICH") {
    if (!job.client_id || !job.segment_id) throw new NationalWorkerBlockedError("Native enrichment requires client and segment scope.");
    return runNativeContactEnrichment(job.client_id, clamp(job.payload?.limit, 1, 50, 20), job.segment_id);
  }
  if (job.worker_type === "PROVIDER_ENRICH") {
    if (!job.client_id || !job.segment_id) throw new NationalWorkerBlockedError("Provider enrichment requires client and segment scope.");
    if (!providerFallbackEnabled()) {
      throw new NationalWorkerBlockedError("Provider fallback is locked until both national fallback and provider-spend switches are explicitly enabled.");
    }
    return enrichQualifiedProspects(job.client_id, clamp(job.payload?.limit, 1, 20, 5), job.segment_id);
  }
  throw new NationalWorkerBlockedError(`Unsupported national worker type: ${job.worker_type}`);
}

async function recoverStaleNationalJobs() {
  await getPool().query(
    `UPDATE connect_worker_jobs
     SET status='RETRY',run_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,
         last_error='Recovered after stale national worker lock.',updated_at=now()
     WHERE worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')
       AND status='RUNNING' AND locked_at < now() - interval '15 minutes'`
  );
}

async function claimNationalJob(workerId: string): Promise<NationalJob | null> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const selected = await db.query(
      `SELECT * FROM connect_worker_jobs
       WHERE worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')
         AND status IN ('QUEUED','RETRY') AND run_at<=now()
       ORDER BY priority ASC,run_at ASC,created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    const row = selected.rows[0];
    if (!row) {
      await db.query("COMMIT");
      return null;
    }
    const attempts = Number(row.attempts ?? 0) + 1;
    const updated = await db.query(
      `UPDATE connect_worker_jobs
       SET status='RUNNING',attempts=$2,locked_at=now(),locked_by=$3,heartbeat_at=now(),
           started_at=coalesce(started_at,now()),last_error=NULL,updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [row.id, attempts, workerId]
    );
    await db.query(
      `INSERT INTO connect_worker_runs(job_id,attempt,worker_id,status)
       VALUES($1,$2,$3,'RUNNING')`,
      [row.id, attempts, workerId]
    );
    await db.query("COMMIT");
    return updated.rows[0] as NationalJob;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function completeNationalJob(job: NationalJob, result: unknown) {
  const pool = getPool();
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status='SUCCEEDED',result=$2::jsonb,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, JSON.stringify(result ?? {})]
  );
  await pool.query(
    `UPDATE connect_worker_runs
     SET status='SUCCEEDED',result=$3::jsonb,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, JSON.stringify(result ?? {})]
  );
}

async function blockNationalJob(job: NationalJob, error: Error) {
  const message = error.message.slice(0, 1000);
  const pool = getPool();
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status='BLOCKED',last_error=$2,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, message]
  );
  await pool.query(
    `UPDATE connect_worker_runs
     SET status='BLOCKED',error_message=$3,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, message]
  );
}

async function failNationalJob(job: NationalJob, error: unknown) {
  const message = (error instanceof Error ? error.message : "Unknown national worker error").slice(0, 1000);
  const retry = job.attempts < job.max_attempts;
  const delaySeconds = Math.min(1800, 30 * Math.pow(2, Math.max(0, job.attempts - 1)));
  const pool = getPool();
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status=$2,last_error=$3,
         run_at=CASE WHEN $2='RETRY' THEN now()+($4*interval '1 second') ELSE run_at END,
         completed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END,
         locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, retry ? "RETRY" : "FAILED", message, delaySeconds]
  );
  await pool.query(
    `UPDATE connect_worker_runs
     SET status=$3,error_message=$4,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, retry ? "RETRY" : "FAILED", message]
  );
  return retry;
}

export async function processNationalResearchJobs(options: { limit?: number; workerId?: string } = {}) {
  const limit = clamp(options.limit, 0, 20, 4);
  const workerId = (options.workerId || `national-${randomUUID()}`).slice(0, 160);
  await recoverStaleNationalJobs();
  const summary = {
    workerId,
    claimed: 0,
    succeeded: 0,
    retried: 0,
    blocked: 0,
    failed: 0,
    jobs: [] as Array<Record<string, unknown>>
  };

  for (let index = 0; index < limit; index++) {
    const job = await claimNationalJob(workerId);
    if (!job) break;
    summary.claimed++;
    try {
      const result = await executeNationalJob(job);
      await completeNationalJob(job, result);
      summary.succeeded++;
      summary.jobs.push({
        id: job.id,
        type: job.worker_type,
        marketId: job.market_id,
        segmentId: job.segment_id,
        status: "SUCCEEDED",
        result
      });
    } catch (error) {
      if (error instanceof NationalWorkerBlockedError) {
        await blockNationalJob(job, error);
        summary.blocked++;
        summary.jobs.push({ id: job.id, type: job.worker_type, status: "BLOCKED", error: error.message });
      } else {
        const retry = await failNationalJob(job, error);
        if (retry) summary.retried++;
        else summary.failed++;
        summary.jobs.push({
          id: job.id,
          type: job.worker_type,
          status: retry ? "RETRY" : "FAILED",
          error: error instanceof Error ? error.message : "Unknown national worker error"
        });
      }
    }
  }
  return summary;
}

export async function getNationalWorkerHealth(clientId: string) {
  const { rows } = await getPool().query(
    `SELECT
       count(*) FILTER (WHERE status='QUEUED')::int AS queued,
       count(*) FILTER (WHERE status='RUNNING')::int AS running,
       count(*) FILTER (WHERE status='RETRY')::int AS retrying,
       count(*) FILTER (WHERE status='SUCCEEDED')::int AS succeeded,
       count(*) FILTER (WHERE status='BLOCKED')::int AS blocked,
       count(*) FILTER (WHERE status='FAILED')::int AS failed,
       count(*) FILTER (WHERE worker_type='RESEARCH' AND status IN ('QUEUED','RUNNING','RETRY'))::int AS research_active,
       count(*) FILTER (WHERE worker_type='NATIVE_ENRICH' AND status IN ('QUEUED','RUNNING','RETRY'))::int AS native_active,
       count(*) FILTER (WHERE worker_type='PROVIDER_ENRICH' AND status IN ('QUEUED','RUNNING','RETRY'))::int AS provider_active,
       max(completed_at) AS last_completed_at
     FROM connect_worker_jobs
     WHERE client_id=$1 AND worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')`,
    [clientId]
  );
  return {
    ...(rows[0] ?? {}),
    nationalResearchEnabled: nationalResearchEnabled(),
    providerFallbackEnabled: providerFallbackEnabled(),
    checkedAt: new Date().toISOString()
  };
}
