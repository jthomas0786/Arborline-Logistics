import { getPool } from "@/lib/db";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { normalizeConnectServiceFitStatus } from "@/lib/connect-service-fit";

const BLOCKED_HOSTS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "yelp.com",
  "yellowpages.com", "google.com", "maps.google.com"
]);

export type OvertureProspectCandidate = {
  id: string;
  name: string;
  website: string;
  city?: string | null;
  confidence?: number | null;
  basicCategory?: string | null;
  taxonomy?: string[] | null;
};

type Segment = {
  id: string;
  client_id: string;
  slug: string;
  name: string;
  service_vertical: string;
  target_industries: string[] | null;
  target_geographies: string[] | null;
  min_employees: number | null;
  max_employees: number | null;
  min_locations: number | null;
  max_locations: number | null;
  facility_types: string[] | null;
  decision_maker_titles: string[] | null;
  buying_signals: string[] | null;
  exclusions: string[] | null;
  minimum_score: number | null;
};

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || BLOCKED_HOSTS.has(host) || [...BLOCKED_HOSTS].some((blocked) => host.endsWith(`.${blocked}`))) return null;
    return host;
  } catch {
    return null;
  }
}

function normalizeWebsite(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!normalizeDomain(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function profileFromSegment(segment: Segment): ConnectIcpProfile {
  return {
    target_industries: segment.target_industries ?? [],
    target_geographies: segment.target_geographies ?? [],
    min_employees: segment.min_employees,
    max_employees: segment.max_employees,
    min_locations: segment.min_locations,
    max_locations: segment.max_locations,
    facility_types: segment.facility_types ?? [],
    decision_maker_titles: segment.decision_maker_titles ?? [],
    buying_signals: segment.buying_signals ?? [],
    exclusions: segment.exclusions ?? [],
    minimum_score: segment.minimum_score ?? 70
  };
}

async function scoreStoredProspect(prospectId: string, segment: Segment) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*, EXISTS (
       SELECT 1 FROM connect_suppressions s
       WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
         AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
           OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
     ) AS is_suppressed
     FROM connect_prospects p WHERE p.id=$1 LIMIT 1`,
    [prospectId]
  );
  const row = rows[0];
  if (!row) return null;
  const suppression = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
  const result = scoreConnectProspect({
    company_name: row.company_name,
    domain: row.domain,
    industry: row.industry,
    industry_fit_status: row.source === "ARBORLINE_DISCOVERY" ? normalizeConnectServiceFitStatus(row.source_metadata?.service_fit?.status) : null,
    city: row.city,
    state: row.state,
    country: row.country,
    employee_count: row.employee_count,
    location_count: row.location_count,
    facility_type: row.facility_type,
    contact_title: row.contact_title,
    buying_signals: row.buying_signals,
    suppression_status: suppression
  }, profileFromSegment(segment));

  // Overture only supplies company/place facts. It never supplies an approved
  // outreach recipient, so a newly ingested record always remains NOT_READY.
  await pool.query(
    `UPDATE connect_prospects
     SET qualification_score=$2,qualification_status=$3,qualification_reasons=$4::jsonb,
         suppression_status=$5,outreach_status='NOT_READY',last_scored_at=now(),updated_at=now()
     WHERE id=$1`,
    [prospectId, result.score, result.status, JSON.stringify(result.reasons), suppression]
  );
  return result;
}

export async function ingestOvertureCandidates(input: {
  clientId: string;
  segmentSlug: string;
  geography: string;
  region: string;
  candidates: OvertureProspectCandidate[];
}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT s.*
     FROM connect_prospect_segments s
     JOIN connect_clients c ON c.id=s.client_id
     WHERE s.client_id=$1
       AND lower(s.slug)=lower($2)
       AND s.status='ACTIVE'
       AND c.status IN ('READY','ACTIVE','ONBOARDING')
     LIMIT 1`,
    [input.clientId, input.segmentSlug]
  );
  const segment = rows[0] as Segment | undefined;
  if (!segment) return { state: "SEGMENT_NOT_ACTIVE" as const, inserted: 0, duplicates: 0, qualified: 0 };

  const geographyAllowed = (segment.target_geographies ?? []).some(
    (value) => String(value).toLowerCase() === input.geography.toLowerCase()
  );
  if (!geographyAllowed) return { state: "GEOGRAPHY_NOT_ACTIVE" as const, inserted: 0, duplicates: 0, qualified: 0 };

  const runResult = await pool.query(
    `INSERT INTO connect_sourcing_runs(client_id,segment_id,provider,status,request_payload,started_at)
     VALUES($1,$2,'ARBORLINE_PUBLIC_OVERTURE','RUNNING',$3::jsonb,now()) RETURNING id`,
    [segment.client_id, segment.id, JSON.stringify({
      source: "OVERTURE_MAPS_PLACES",
      segment: segment.slug,
      geography: input.geography,
      region: input.region,
      candidateCount: input.candidates.length,
      mode: "PUBLIC_OPEN_PLACES"
    })]
  );
  const runId = String(runResult.rows[0].id);

  try {
    const unique = new Map<string, OvertureProspectCandidate & { website: string; domain: string }>();
    for (const raw of input.candidates.slice(0, 60)) {
      const name = String(raw.name ?? "").trim().slice(0, 180);
      const website = normalizeWebsite(raw.website);
      const domain = normalizeDomain(website);
      if (!name || !website || !domain || !String(raw.id ?? "").trim()) continue;
      if (!unique.has(domain)) unique.set(domain, { ...raw, name, website, domain });
      if (unique.size >= 30) break;
    }

    let inserted = 0;
    let duplicates = 0;
    let qualified = 0;
    const insertedIds: string[] = [];

    for (const candidate of unique.values()) {
      const city = String(candidate.city ?? "").trim().slice(0, 100) || null;
      const duplicate = await pool.query(
        `SELECT 1 FROM connect_prospects
         WHERE client_id=$1 AND (
           lower(domain)=lower($2)
           OR (lower(company_name)=lower($3) AND coalesce(lower(city),'')=coalesce(lower($4),''))
         ) LIMIT 1`,
        [segment.client_id, candidate.domain, candidate.name, city]
      );
      if (duplicate.rowCount) {
        duplicates++;
        continue;
      }

      const saved = await pool.query(
        `INSERT INTO connect_prospects(
           client_id,segment_id,company_name,website,domain,industry,city,state,country,
           source,source_url,buying_signals,enrichment_status,outreach_status,source_metadata
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'US','ARBORLINE_DISCOVERY',$9,'{}'::text[],'PARTIAL','NOT_READY',$10::jsonb)
         RETURNING id`,
        [
          segment.client_id,
          segment.id,
          candidate.name,
          candidate.website,
          candidate.domain,
          (segment.target_industries?.[0] || segment.service_vertical || segment.name).slice(0, 140),
          city,
          input.geography,
          "https://overturemaps.org/",
          JSON.stringify({
            discovery_provider: "OVERTURE_MAPS",
            overture_id: String(candidate.id),
            overture_confidence: candidate.confidence ?? null,
            overture_basic_category: candidate.basicCategory ?? null,
            overture_taxonomy: candidate.taxonomy ?? [],
            discovery_geography: input.geography,
            discovery_region: input.region,
            discovery_segment: segment.slug,
            discovery_checked_at: new Date().toISOString()
          })
        ]
      );
      const id = String(saved.rows[0].id);
      insertedIds.push(id);
      inserted++;
      const score = await scoreStoredProspect(id, segment);
      if (score?.status === "QUALIFIED") qualified++;
    }

    await pool.query(
      `UPDATE connect_sourcing_runs
       SET status='COMPLETED',discovered_count=$2,inserted_count=$3,duplicate_count=$4,qualified_count=$5,completed_at=now()
       WHERE id=$1`,
      [runId, unique.size, inserted, duplicates, qualified]
    );

    return {
      state: "COMPLETED" as const,
      provider: "ARBORLINE_PUBLIC_OVERTURE" as const,
      runId,
      discovered: unique.size,
      inserted,
      duplicates,
      qualified,
      insertedIds
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Overture ingestion failed.";
    await pool.query(
      `UPDATE connect_sourcing_runs SET status='FAILED',error_message=$2,completed_at=now() WHERE id=$1`,
      [runId, message.slice(0, 1000)]
    );
    return { state: "FAILED" as const, provider: "ARBORLINE_PUBLIC_OVERTURE" as const, runId, inserted: 0, duplicates: 0, qualified: 0, error: message };
  }
}
