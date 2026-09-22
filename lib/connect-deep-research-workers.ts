import { getPool } from "@/lib/db";
import { runNativeContactEnrichment } from "@/lib/connect-native-enrichment";
import {
  expandDecisionMakerTitles,
  scoreContactTarget
} from "@/lib/connect-contact-targeting";
import {
  scoreConnectProspect,
  type ConnectIcpProfile,
  type ConnectProspectInput
} from "@/lib/connect-prospect-scoring";
import {
  researchPublicCompanySite,
  type PublicResearchCandidate,
  type PublicResearchResult
} from "@/lib/connect-public-research";

const TOP_EXECUTIVE_TITLES = [
  "Owner",
  "Founder",
  "Co-Founder",
  "President",
  "Chief Executive Officer",
  "CEO",
  "Managing Partner",
  "Principal"
];

const OPERATING_EXECUTIVE_TITLES = [
  "Chief Operating Officer",
  "COO",
  "General Manager",
  "Managing Director",
  "Regional Director",
  "Vice President of Operations",
  "VP Operations",
  "Director of Operations"
];

const RECHECK_DAYS = 30;

type ProspectRow = Record<string, unknown> & {
  id: string;
  client_id: string;
  segment_id: string;
  market_id: string | null;
  company_name: string;
  domain: string;
  source: string;
  source_metadata: Record<string, unknown> | null;
  qualification_status: string;
  qualification_score: number | null;
  suppression_status: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  outreach_status: string | null;
  city: string | null;
  state: string | null;
  employee_count: number | null;
  location_count: number | null;
  has_outreach_history: boolean;
  segment_slug: string;
  segment_titles: unknown;
  segment_target_industries: unknown;
  segment_target_geographies: unknown;
  segment_facility_types: unknown;
  segment_buying_signals: unknown;
  segment_exclusions: unknown;
  segment_minimum_score: number | null;
  segment_min_employees: number | null;
  segment_max_employees: number | null;
  segment_min_locations: number | null;
  segment_max_locations: number | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePersonName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function profileFromRow(row: ProspectRow): ConnectIcpProfile {
  return {
    target_industries: asStringArray(row.segment_target_industries),
    target_geographies: asStringArray(row.segment_target_geographies),
    min_employees: row.segment_min_employees,
    max_employees: row.segment_max_employees,
    min_locations: row.segment_min_locations,
    max_locations: row.segment_max_locations,
    facility_types: asStringArray(row.segment_facility_types),
    decision_maker_titles: asStringArray(row.segment_titles),
    buying_signals: asStringArray(row.segment_buying_signals),
    exclusions: asStringArray(row.segment_exclusions),
    minimum_score: Number(row.segment_minimum_score ?? 70)
  };
}

function serviceFitStatus(value: unknown): ConnectProspectInput["industry_fit_status"] {
  const normalized = String(value ?? "UNVERIFIED").toUpperCase();
  if (normalized === "MATCH" || normalized === "REVIEW" || normalized === "MISMATCH" || normalized === "UNVERIFIED") {
    return normalized;
  }
  return "UNVERIFIED";
}

function publicResearchPatch(
  result: PublicResearchResult,
  candidate: PublicResearchCandidate,
  mode: "DEEP_DECISION_MAKER" | "DEEP_PUBLISHED_EMAIL"
) {
  return {
    status: result.status,
    research_mode: mode,
    domain: result.domain,
    decision_maker_name: candidate.name,
    decision_maker_title: candidate.title,
    decision_maker_confidence: candidate.decisionMakerConfidence,
    decision_maker_confidence_grade: candidate.confidenceGrade,
    decision_maker_corroborating_pages: candidate.corroboratingPages,
    decision_maker_proximity: candidate.proximity,
    decision_maker_source_kind: candidate.sourceKind,
    published_email: candidate.publishedEmail,
    email_status: candidate.publishedEmail
      ? "PUBLISHED_UNVERIFIED"
      : candidate.inferredEmailCandidates.length
        ? "INFERRED_UNVERIFIED"
        : "NONE",
    email_confidence: candidate.emailConfidence,
    inferred_email_candidates: candidate.inferredEmailCandidates,
    published_company_emails: result.publishedEmails.slice(0, 20),
    source_url: candidate.sourceUrl,
    pages_checked: result.pagesChecked.slice(0, 20),
    evidence: candidate.evidence,
    robots_respected: result.robotsRespected,
    error: result.error ?? null
  };
}

async function candidateRows(clientId: string, mode: "dm" | "email", limit: number) {
  const safeLimit = Math.max(1, Math.min(6, Math.floor(limit || 2)));
  const deepKey = mode === "dm" ? "deep_decision_maker_research" : "deep_published_email_research";
  const { rows } = await getPool().query<ProspectRow>(
    `SELECT p.*,
            EXISTS (
              SELECT 1 FROM connect_outreach_messages history
              WHERE history.prospect_id=p.id
                AND history.status IN ('DRAFT','QUEUED','SENT','DELIVERED','BOUNCED','FAILED')
            ) AS has_outreach_history,
            s.slug AS segment_slug,
            s.decision_maker_titles AS segment_titles,
            s.target_industries AS segment_target_industries,
            s.target_geographies AS segment_target_geographies,
            s.facility_types AS segment_facility_types,
            s.buying_signals AS segment_buying_signals,
            s.exclusions AS segment_exclusions,
            s.minimum_score AS segment_minimum_score,
            s.min_employees AS segment_min_employees,
            s.max_employees AS segment_max_employees,
            s.min_locations AS segment_min_locations,
            s.max_locations AS segment_max_locations,
            coalesce((
              SELECT min(ms.priority)
              FROM connect_market_segments ms
              WHERE ms.client_id=p.client_id
                AND ms.segment_id=p.segment_id
                AND ms.market_id=p.market_id
                AND ms.status='ACTIVE'
            ),100) AS market_priority
     FROM connect_prospects p
     JOIN connect_prospect_segments s
       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')
     WHERE p.client_id=$1
       AND p.segment_id IS NOT NULL
       AND p.domain IS NOT NULL
       AND (
         (
           $2::text='dm'
           AND nullif(p.source_metadata->'decision_maker_refresh'->>'requested_at','') IS NOT NULL
                  AND coalesce(p.source_metadata->'decision_maker_refresh'->>'status','PENDING')='PENDING'
         )
         OR (
           p.suppression_status='CLEAR'
           AND p.contact_email IS NULL
           AND (
             p.qualification_status='QUALIFIED'
             OR (p.qualification_status='REVIEW' AND coalesce(p.qualification_score,0)>=60)
           )
           AND (p.source<>'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
           AND (
             ($2::text='dm' AND (
               coalesce(p.source_metadata->$3->>'checked_at','')=''
               OR (p.source_metadata->$3->>'checked_at')::timestamptz <= now()-interval '${RECHECK_DAYS} days'
             ))
             OR ($2::text='email'
               AND p.contact_name IS NOT NULL
               AND p.contact_title IS NOT NULL
               AND (
                 coalesce(p.source_metadata->$3->>'checked_at','')=''
                 OR (p.source_metadata->$3->>'checked_at')::timestamptz <= now()-interval '${RECHECK_DAYS} days'
               )
             )
           )
         )
       )
     ORDER BY CASE
                WHEN $2::text='dm'
                  AND nullif(p.source_metadata->'decision_maker_refresh'->>'requested_at','') IS NOT NULL
                  AND coalesce(p.source_metadata->'decision_maker_refresh'->>'status','PENDING')='PENDING' THEN 0 ELSE 1
              END,
              CASE WHEN EXISTS (
                SELECT 1 FROM connect_outreach_messages history
                WHERE history.prospect_id=p.id AND history.status IN ('SENT','DELIVERED')
              ) THEN 0 ELSE 1 END,
              CASE WHEN EXISTS (
                SELECT 1 FROM connect_prepared_outreach_drafts pd
                WHERE pd.prospect_id=p.id AND pd.status='PREPARED'
              ) THEN 0 ELSE 1 END,
              coalesce((
                SELECT min(ms.priority)
                FROM connect_market_segments ms
                WHERE ms.client_id=p.client_id
                  AND ms.segment_id=p.segment_id
                  AND ms.market_id=p.market_id
                  AND ms.status='ACTIVE'
              ),100) ASC,
              CASE WHEN $2::text='dm' AND p.contact_name IS NULL THEN 0 ELSE 1 END,
              CASE WHEN p.qualification_status='QUALIFIED' THEN 0 ELSE 1 END,
              p.qualification_score DESC NULLS LAST,
              p.updated_at ASC
     LIMIT $4`,
    [clientId, mode, deepKey, safeLimit]
  );
  return rows;
}
async function executiveResearch(row: ProspectRow) {
  const titles = expandDecisionMakerTitles(asStringArray(row.segment_titles));
  return researchPublicCompanySite(
    row.domain,
    titles,
    row.segment_slug,
    asStringArray(row.segment_target_industries),
    {
      expanded: true,
      includePublicProfiles: true,
      targetCity: row.city,
      targetState: row.state,
      employeeCount: row.employee_count,
      locationCount: row.location_count
    }
  );
}
async function publishedEmailResearch(row: ProspectRow) {
  const currentTitle = String(row.contact_title ?? "").trim();
  const segmentTitles = asStringArray(row.segment_titles);
  const titlePasses = [
    unique([currentTitle]),
    unique([currentTitle, ...TOP_EXECUTIVE_TITLES, ...OPERATING_EXECUTIVE_TITLES, ...segmentTitles])
  ].filter((titles) => titles.length > 0);

  let fallback: PublicResearchResult | null = null;
  for (const titles of titlePasses) {
    const result = await researchPublicCompanySite(
      row.domain,
      titles,
      row.segment_slug,
      asStringArray(row.segment_target_industries),
      { expanded: true, includePublicProfiles: true }
    );
    fallback = result;
    const candidate = result.candidate;
    if (
      candidate?.publishedEmail &&
      normalizePersonName(candidate.name) === normalizePersonName(row.contact_name)
    ) return result;
  }
  return fallback;
}

async function saveDecisionMakerResult(row: ProspectRow, result: PublicResearchResult | null) {
  const pool = getPool();
  const checkedAt = new Date().toISOString();
  const candidate = result?.candidate ?? null;
  const metadata = asObject(row.source_metadata);
  const manual = asObject(metadata.manual_public_profile_research);
  const refresh = asObject(metadata.decision_maker_refresh);
  const refreshRequested = Boolean(String(refresh.requested_at ?? "").trim());
  const manualIdentityLocked = Boolean(String(manual.decision_maker_name ?? "").trim());
  const hasExistingRecipient = Boolean(String(row.contact_email ?? "").trim());
  const preserveExistingIdentity = hasExistingRecipient || Boolean(row.has_outreach_history);
  const candidateStrong = Boolean(candidate?.name && candidate?.title && candidate.decisionMakerConfidence >= 85);
  const samePerson = candidateStrong && normalizePersonName(candidate?.name) === normalizePersonName(row.contact_name);
  const targetingContext = {
    targetCity: row.city,
    targetState: row.state,
    employeeCount: row.employee_count,
    locationCount: row.location_count
  };
  const currentTargetScore = row.contact_title
    ? scoreContactTarget(String(row.contact_title), "", "", targetingContext).score
    : 0;
  const candidateTargetScore = Number(candidate?.targetingScore ?? 0);
  const materiallyBetterTarget = Boolean(
    candidateStrong &&
    candidate!.decisionMakerConfidence >= 90 &&
    candidateTargetScore >= currentTargetScore + 5
  );
  const canPersistIdentity = Boolean(
    candidateStrong &&
    !manualIdentityLocked &&
    !preserveExistingIdentity &&
    row.suppression_status === "CLEAR" &&
    (!row.contact_name || samePerson || materiallyBetterTarget)
  );
  const isNewPerson = Boolean(
    candidateStrong &&
    normalizePersonName(candidate?.name) !== normalizePersonName(row.contact_name)
  );

  const deepRecord = {
    checked_at: checkedAt,
    status: result?.status ?? "NO_RESULT",
    mode: "LOCATION_FUNCTION_TARGETING",
    candidate_name: candidate?.name ?? null,
    candidate_title: candidate?.title ?? null,
    identity_confidence: candidate?.decisionMakerConfidence ?? 0,
    targeting_score: candidateTargetScore,
    targeting_role_function: candidate?.targetingRoleFunction ?? null,
    targeting_seniority: candidate?.targetingSeniority ?? null,
    targeting_location_match: candidate?.targetingLocationMatch ?? null,
    targeting_reasons: candidate?.targetingReasons ?? [],
    published_email: candidate?.publishedEmail ?? null,
    source_kind: candidate?.sourceKind ?? null,
    source_url: candidate?.sourceUrl ?? null,
    pages_checked: result?.pagesChecked.slice(0, 20) ?? [],
    evidence: candidate?.evidence ?? [],
    manual_identity_preserved: manualIdentityLocked,
    existing_contact_preserved: preserveExistingIdentity,
    identity_persisted: canPersistIdentity,
    error: result?.error ?? null
  };
  const refreshRecord = {
    ...refresh,
    version: 1,
    status: "COMPLETED",
    last_checked_at: checkedAt,
    include_prior_outreach: true,
    preserve_existing_contact: true,
    existing_contact_preserved: preserveExistingIdentity,
    existing_contact_snapshot: {
      name: row.contact_name,
      title: row.contact_title,
      email: row.contact_email,
      outreach_status: row.outreach_status,
      had_outreach_history: Boolean(row.has_outreach_history)
    },
    candidate_found: Boolean(candidateStrong),
    is_new_person: isNewPerson,
    candidate_name: candidate?.name ?? null,
    candidate_title: candidate?.title ?? null,
    candidate_identity_confidence: candidate?.decisionMakerConfidence ?? 0,
    candidate_targeting_score: candidateTargetScore,
    candidate_role_function: candidate?.targetingRoleFunction ?? null,
    candidate_location_match: candidate?.targetingLocationMatch ?? null,
    candidate_source_kind: candidate?.sourceKind ?? null,
    candidate_source_url: candidate?.sourceUrl ?? null,
    candidate_published_email: candidate?.publishedEmail ?? null,
    candidate_mailbox_verified: false,
    shared_inbox_candidates: result?.sharedInboxCandidates?.slice(0, 10) ?? [],
    evidence: candidate?.evidence ?? []
  };

  if (candidate && canPersistIdentity && result) {
    const publicPatch = publicResearchPatch(result, candidate, "DEEP_DECISION_MAKER");
    if (refreshRequested) {
      await pool.query(
        `UPDATE connect_prospects
         SET contact_name=$2,
             contact_title=$3,
             source_metadata=(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_decision_maker_research}',$4::jsonb,true),
                   '{public_research}',coalesce(source_metadata->'public_research','{}'::jsonb)||$5::jsonb,true
                 ),
                 '{decision_maker_refresh}',$6::jsonb,true
               ) #- '{native_contact_enrichment,checked_at}'
             ) #- '{native_contact_enrichment,provider_fallback_recommended}',
             updated_at=now()
         WHERE id=$1`,
        [row.id, candidate.name, candidate.title, JSON.stringify(deepRecord), JSON.stringify(publicPatch), JSON.stringify(refreshRecord)]
      );
    } else {
      await pool.query(
        `UPDATE connect_prospects
         SET contact_name=$2,
             contact_title=$3,
             source_metadata=(
               jsonb_set(
                 jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_decision_maker_research}',$4::jsonb,true),
                 '{public_research}',coalesce(source_metadata->'public_research','{}'::jsonb)||$5::jsonb,true
               ) #- '{native_contact_enrichment,checked_at}'
             ) #- '{native_contact_enrichment,provider_fallback_recommended}',
             updated_at=now()
         WHERE id=$1`,
        [row.id, candidate.name, candidate.title, JSON.stringify(deepRecord), JSON.stringify(publicPatch)]
      );
    }

    const scored = scoreConnectProspect({
      company_name: row.company_name,
      domain: row.domain,
      industry: row.industry as string | null | undefined,
      industry_fit_status: row.source === "ARBORLINE_DISCOVERY"
        ? serviceFitStatus(asObject(metadata.service_fit).status)
        : null,
      city: row.city,
      state: row.state,
      country: row.country as string | null | undefined,
      employee_count: row.employee_count,
      location_count: row.location_count,
      facility_type: row.facility_type as string | null | undefined,
      contact_title: candidate.title,
      buying_signals: asStringArray(row.buying_signals),
      suppression_status: row.suppression_status
    }, profileFromRow(row));

    await pool.query(
      `UPDATE connect_prospects
       SET qualification_score=$2,
           qualification_status=$3,
           qualification_reasons=$4::jsonb,
           outreach_status=CASE WHEN $3='SUPPRESSED' THEN 'STOPPED' ELSE 'NOT_READY' END,
           last_scored_at=now(),updated_at=now()
       WHERE id=$1`,
      [row.id, scored.score, scored.status, JSON.stringify(scored.reasons)]
    );

    return {
      persisted: true,
      qualified: scored.status === "QUALIFIED",
      publishedEmail: Boolean(candidate.publishedEmail),
      alternativeFound: isNewPerson,
      existingContactPreserved: false
    };
  }

  if (refreshRequested) {
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=jsonb_set(
             jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_decision_maker_research}',$2::jsonb,true),
             '{decision_maker_refresh}',$3::jsonb,true
           ),
           updated_at=now()
       WHERE id=$1`,
      [row.id, JSON.stringify(deepRecord), JSON.stringify(refreshRecord)]
    );
  } else {
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_decision_maker_research}',$2::jsonb,true),
           updated_at=now()
       WHERE id=$1`,
      [row.id, JSON.stringify(deepRecord)]
    );
  }

  return {
    persisted: false,
    qualified: row.qualification_status === "QUALIFIED",
    publishedEmail: Boolean(candidate?.publishedEmail),
    alternativeFound: isNewPerson,
    existingContactPreserved: preserveExistingIdentity
  };
}
async function savePublishedEmailResult(row: ProspectRow, result: PublicResearchResult | null) {
  const checkedAt = new Date().toISOString();
  const candidate = result?.candidate ?? null;
  const exactIdentity = Boolean(
    candidate?.name &&
    normalizePersonName(candidate.name) === normalizePersonName(row.contact_name)
  );
  const boundPublishedEmail = exactIdentity ? candidate?.publishedEmail ?? null : null;
  const deepRecord = {
    checked_at: checkedAt,
    status: result?.status ?? "NO_RESULT",
    mode: "EXACT_IDENTITY_EMAIL_HUNT",
    target_name: row.contact_name,
    target_title: row.contact_title,
    candidate_name: candidate?.name ?? null,
    candidate_title: candidate?.title ?? null,
    exact_identity_match: exactIdentity,
    published_email: boundPublishedEmail,
    unbound_company_emails: result?.publishedEmails.slice(0, 20) ?? [],
    source_kind: candidate?.sourceKind ?? null,
    source_url: candidate?.sourceUrl ?? null,
    pages_checked: result?.pagesChecked.slice(0, 20) ?? [],
    evidence: candidate?.evidence ?? [],
    error: result?.error ?? null
  };

  if (boundPublishedEmail && candidate && result) {
    const patch = publicResearchPatch(result, candidate, "DEEP_PUBLISHED_EMAIL");
    await getPool().query(
      `UPDATE connect_prospects
       SET source_metadata=(
             jsonb_set(
               jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_published_email_research}',$2::jsonb,true),
               '{public_research}',coalesce(source_metadata->'public_research','{}'::jsonb)||$3::jsonb,true
             ) #- '{native_contact_enrichment,checked_at}'
           ) #- '{native_contact_enrichment,provider_fallback_recommended}',
           updated_at=now()
       WHERE id=$1`,
      [row.id, JSON.stringify(deepRecord), JSON.stringify(patch)]
    );
    return { found: true, email: boundPublishedEmail };
  }

  await getPool().query(
    `UPDATE connect_prospects
     SET source_metadata=jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_published_email_research}',$2::jsonb,true),
         updated_at=now()
     WHERE id=$1`,
    [row.id, JSON.stringify(deepRecord)]
  );
  return { found: false, email: null };
}

export async function runDeepDecisionMakerWorker(clientId: string, limit = 2) {
  const rows = await candidateRows(clientId, "dm", limit);
  const summary = {
    worker: "DEEP_DECISION_MAKER" as const,
    attempted: 0,
    candidatesFound: 0,
    identitiesPersisted: 0,
    newlyQualified: 0,
    publishedEmailsFound: 0,
    errors: 0,
    providerSpendUsed: false,
    outreachMessagesCreated: 0,
    messagesSent: 0
  };

  for (const row of rows) {
    summary.attempted++;
    try {
      const result = await executiveResearch(row);
      if (result?.candidate) summary.candidatesFound++;
      const saved = await saveDecisionMakerResult(row, result);
      if (saved.persisted) summary.identitiesPersisted++;
      if (saved.persisted && saved.qualified && row.qualification_status !== "QUALIFIED") summary.newlyQualified++;
      if (saved.publishedEmail) summary.publishedEmailsFound++;
    } catch (error) {
      summary.errors++;
      await getPool().query(
        `UPDATE connect_prospects
         SET source_metadata=jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_decision_maker_research}',$2::jsonb,true),updated_at=now()
         WHERE id=$1`,
        [row.id, JSON.stringify({
          checked_at: new Date().toISOString(),
          status: "ERROR",
          error: error instanceof Error ? error.message.slice(0, 500) : "Unknown deep decision-maker error"
        })]
      );
    }
  }
  return summary;
}

export async function runDeepPublishedEmailWorker(clientId: string, limit = 2) {
  const rows = await candidateRows(clientId, "email", limit);
  const summary = {
    worker: "DEEP_PUBLISHED_EMAIL" as const,
    attempted: 0,
    exactPublishedEmailsFound: 0,
    unboundCompanyEmailsObserved: 0,
    errors: 0,
    providerSpendUsed: false,
    contactsPromoted: 0,
    outreachMessagesCreated: 0,
    messagesSent: 0
  };

  for (const row of rows) {
    summary.attempted++;
    try {
      const result = await publishedEmailResearch(row);
      summary.unboundCompanyEmailsObserved += result?.publishedEmails.length ?? 0;
      const saved = await savePublishedEmailResult(row, result);
      if (saved.found) summary.exactPublishedEmailsFound++;
    } catch (error) {
      summary.errors++;
      await getPool().query(
        `UPDATE connect_prospects
         SET source_metadata=jsonb_set(coalesce(source_metadata,'{}'::jsonb),'{deep_published_email_research}',$2::jsonb,true),updated_at=now()
         WHERE id=$1`,
        [row.id, JSON.stringify({
          checked_at: new Date().toISOString(),
          status: "ERROR",
          error: error instanceof Error ? error.message.slice(0, 500) : "Unknown deep published-email error"
        })]
      );
    }
  }
  return summary;
}

export async function runDeepNativeCandidateWorker(clientId: string, limit = 20) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 20)));
  const { rows } = await getPool().query<{ segment_id: string; due: number }>(
    `SELECT p.segment_id,count(*)::int AS due
     FROM connect_prospects p
     JOIN connect_prospect_segments s
       ON s.id=p.segment_id AND s.client_id=p.client_id AND s.status IN ('APPROVED','ACTIVE')
     WHERE p.client_id=$1
       AND p.segment_id IS NOT NULL
       AND p.qualification_status='QUALIFIED'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NULL
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.domain IS NOT NULL
       AND (p.source<>'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND (
         coalesce(p.source_metadata->'native_contact_enrichment'->>'checked_at','')=''
         OR coalesce(p.source_metadata->'deep_decision_maker_research'->>'checked_at','') >= coalesce(p.source_metadata->'native_contact_enrichment'->>'checked_at','')
         OR coalesce(p.source_metadata->'deep_published_email_research'->>'checked_at','') >= coalesce(p.source_metadata->'native_contact_enrichment'->>'checked_at','')
       )
     GROUP BY p.segment_id
     ORDER BY count(*) DESC,p.segment_id
     LIMIT 12`,
    [clientId]
  );

  let remaining = safeLimit;
  const totals = {
    worker: "DEEP_NATIVE_CANDIDATES" as const,
    segmentsProcessed: 0,
    attempted: 0,
    candidatesStored: 0,
    publishedCandidates: 0,
    learnedPatternCandidates: 0,
    mxValid: 0,
    mailboxVerified: 0,
    contactsPromoted: 0,
    providerSpendUsed: false,
    outreachMessagesCreated: 0,
    messagesSent: 0
  };

  for (const row of rows) {
    if (remaining <= 0) break;
    const batch = Math.max(1, Math.min(remaining, Number(row.due || 0), 10));
    const result = await runNativeContactEnrichment(clientId, batch, String(row.segment_id));
    totals.segmentsProcessed++;
    totals.attempted += result.attempted;
    totals.candidatesStored += result.candidatesStored;
    totals.publishedCandidates += result.publishedCandidates;
    totals.learnedPatternCandidates += result.learnedPatternCandidates;
    totals.mxValid += result.mxValid;
    totals.mailboxVerified += result.mailboxVerified;
    totals.contactsPromoted += result.contactsPromoted;
    remaining -= Math.max(1, result.attempted);
  }

  return totals;
}
