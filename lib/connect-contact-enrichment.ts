import { getPool } from "@/lib/db";

type ProspeoSearchPerson = {
  person?: {
    person_id?: string;
    full_name?: string | null;
    current_job_title?: string | null;
  };
};

type ProspeoEnrichResponse = {
  error?: boolean;
  person?: {
    full_name?: string | null;
    current_job_title?: string | null;
    email?: {
      status?: string | null;
      revealed?: boolean;
      email?: string | null;
    } | null;
  } | null;
};

class ProspeoApiError extends Error {
  constructor(public status: number, public code: string | null) {
    super(`Prospeo returned ${status}${code ? ` (${code})` : ""}.`);
    this.name = "ProspeoApiError";
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let lastProspeoSearchAt = 0;

export function contactEnrichmentProvider() {
  if (process.env.PROSPEO_API_KEY?.trim()) return "PROSPEO";
  if (process.env.HUNTER_API_KEY?.trim()) return "HUNTER";
  return "NONE";
}

export function contactEnrichmentConfigured() {
  return contactEnrichmentProvider() !== "NONE";
}

async function prospeoPost<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.PROSPEO_API_KEY?.trim();
  if (!key) throw new Error("PROSPEO_API_KEY is not configured.");

  // Prospeo Free/Starter search endpoints allow only one request per second.
  // Pace searches conservatively so a multi-prospect run does not trip the provider.
  if (path === "search-person") {
    const waitMs = 1100 - (Date.now() - lastProspeoSearchAt);
    if (waitMs > 0) await sleep(waitMs);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    if (path === "search-person") lastProspeoSearchAt = Date.now();

    const response = await fetch(`https://api.prospeo.io/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-KEY": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
    const json = await response.json().catch(() => ({}));

    if (response.status === 429 && attempt < 3) {
      // 429s are not billed by Prospeo. Back off and retry rather than aborting the batch.
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1250 * (attempt + 1);
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      const code = typeof json?.error_code === "string" ? json.error_code : null;
      throw new ProspeoApiError(response.status, code);
    }
    return json as T;
  }

  throw new ProspeoApiError(429, "Rate limit exceeded");
}

async function enrichWithProspeo(domain: string, titles: string[]) {
  let search: { error?: boolean; results?: ProspeoSearchPerson[] };
  try {
    search = await prospeoPost<{ error?: boolean; results?: ProspeoSearchPerson[] }>("search-person", {
      page: 1,
      filters: {
        person_job_title: { include: titles.slice(0, 15), match_mode: "CONTAINS" },
        company: { websites: { include: [domain] } }
      }
    });
  } catch (error) {
    // Prospeo returns HTTP 400 for a valid search that simply has no matches.
    if (error instanceof ProspeoApiError && error.code === "NO_RESULTS") return null;
    throw error;
  }

  const candidate = search.results?.find(r => r.person?.person_id)?.person;
  if (!candidate?.person_id) return null;

  let enriched: ProspeoEnrichResponse;
  try {
    enriched = await prospeoPost<ProspeoEnrichResponse>("enrich-person", {
      only_verified_email: true,
      data: { person_id: candidate.person_id }
    });
  } catch (error) {
    // NO_MATCH also covers a matched person who does not have a verified email.
    if (error instanceof ProspeoApiError && error.code === "NO_MATCH") return null;
    throw error;
  }

  const email = enriched.person?.email?.email?.trim().toLowerCase();
  if (!email || enriched.person?.email?.status !== "VERIFIED" || enriched.person?.email?.revealed !== true) return null;
  return {
    name: enriched.person?.full_name?.trim() || candidate.full_name?.trim() || null,
    title: enriched.person?.current_job_title?.trim() || candidate.current_job_title?.trim() || null,
    email,
    metadata: { prospeo_person_id: candidate.person_id, email_status: "VERIFIED" }
  };
}

export async function enrichQualifiedProspects(clientId: string, limit = 20, segmentId?: string | null) {
  const provider = contactEnrichmentProvider();
  if (provider === "NONE") return { status: "NEEDS_PROVIDER", attempted: 0, enriched: 0, suppressed: 0 } as const;
  if (provider === "HUNTER") return { status: "HUNTER_PENDING", attempted: 0, enriched: 0, suppressed: 0 } as const;

  const pool = getPool();
  const profileRows = segmentId
    ? await pool.query(`SELECT decision_maker_titles FROM connect_prospect_segments WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`, [segmentId, clientId])
    : await pool.query(`SELECT decision_maker_titles FROM connect_icp_profiles WHERE client_id=$1`, [clientId]);
  const titles = Array.isArray(profileRows.rows[0]?.decision_maker_titles) ? profileRows.rows[0].decision_maker_titles.map(String).filter(Boolean) : [];
  if (!titles.length) throw new Error(segmentId ? "Prospect segment has no approved decision-maker titles." : "Client ICP has no decision-maker titles.");

  const { rows } = await pool.query(`SELECT id,domain,company_name FROM connect_prospects
    WHERE client_id=$1
      AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
      AND qualification_status='QUALIFIED' AND enrichment_status='PARTIAL' AND contact_email IS NULL AND domain IS NOT NULL
    ORDER BY qualification_score DESC, created_at ASC LIMIT $2`, [clientId, Math.min(Math.max(limit, 1), 20), segmentId ?? null]);

  let attempted = 0;
  let enriched = 0;
  let suppressed = 0;

  for (const row of rows) {
    attempted++;
    const found = await enrichWithProspeo(String(row.domain), titles);
    if (!found) continue;

    const blocked = await pool.query(`SELECT 1 FROM connect_suppressions
      WHERE (client_id IS NULL OR client_id=$1) AND ((email IS NOT NULL AND lower(email)=lower($2)) OR (domain IS NOT NULL AND lower(domain)=lower($3))) LIMIT 1`,
      [clientId, found.email, row.domain]);
    if (blocked.rowCount) {
      suppressed++;
      await pool.query(`UPDATE connect_prospects SET suppression_status='DO_NOT_CONTACT',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now() WHERE id=$1`, [row.id]);
      continue;
    }

    await pool.query(`UPDATE connect_prospects SET contact_name=$2,contact_title=$3,contact_email=$4,enrichment_status='ENRICHED',outreach_status='READY',source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,updated_at=now() WHERE id=$1`,
      [row.id, found.name, found.title, found.email, JSON.stringify({ contact_enrichment_provider: "PROSPEO", segment_id: segmentId ?? null, ...found.metadata })]);
    enriched++;
  }

  return { status: "COMPLETED", attempted, enriched, suppressed } as const;
}
