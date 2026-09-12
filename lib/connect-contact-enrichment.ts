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
  const response = await fetch(`https://api.prospeo.io/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-KEY": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof json?.error_code === "string" ? ` (${json.error_code})` : "";
    throw new Error(`Prospeo returned ${response.status}${code}.`);
  }
  return json as T;
}

async function enrichWithProspeo(domain: string, titles: string[]) {
  const search = await prospeoPost<{ error?: boolean; results?: ProspeoSearchPerson[] }>("search-person", {
    page: 1,
    filters: {
      person_job_title: { include: titles.slice(0, 15), match_mode: "CONTAINS" },
      company: { websites: { include: [domain] } }
    }
  });
  const candidate = search.results?.find(r => r.person?.person_id)?.person;
  if (!candidate?.person_id) return null;

  const enriched = await prospeoPost<ProspeoEnrichResponse>("enrich-person", {
    only_verified_email: true,
    data: { person_id: candidate.person_id }
  });
  const email = enriched.person?.email?.email?.trim().toLowerCase();
  if (!email || enriched.person?.email?.status !== "VERIFIED" || enriched.person?.email?.revealed !== true) return null;
  return {
    name: enriched.person?.full_name?.trim() || candidate.full_name?.trim() || null,
    title: enriched.person?.current_job_title?.trim() || candidate.current_job_title?.trim() || null,
    email,
    metadata: { prospeo_person_id: candidate.person_id, email_status: "VERIFIED" }
  };
}

export async function enrichQualifiedProspects(clientId: string, limit = 20) {
  const provider = contactEnrichmentProvider();
  if (provider === "NONE") return { status: "NEEDS_PROVIDER", attempted: 0, enriched: 0, suppressed: 0 } as const;
  if (provider === "HUNTER") return { status: "HUNTER_PENDING", attempted: 0, enriched: 0, suppressed: 0 } as const;

  const pool = getPool();
  const { rows: icpRows } = await pool.query(`SELECT decision_maker_titles FROM connect_icp_profiles WHERE client_id=$1`, [clientId]);
  const titles = Array.isArray(icpRows[0]?.decision_maker_titles) ? icpRows[0].decision_maker_titles.map(String).filter(Boolean) : [];
  if (!titles.length) throw new Error("Client ICP has no decision-maker titles.");

  const { rows } = await pool.query(`SELECT id,domain,company_name FROM connect_prospects
    WHERE client_id=$1 AND qualification_status='QUALIFIED' AND enrichment_status='PARTIAL' AND contact_email IS NULL AND domain IS NOT NULL
    ORDER BY qualification_score DESC, created_at ASC LIMIT $2`, [clientId, Math.min(Math.max(limit, 1), 20)]);

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
      [row.id, found.name, found.title, found.email, JSON.stringify({ contact_enrichment_provider: "PROSPEO", ...found.metadata })]);
    enriched++;
  }

  return { status: "COMPLETED", attempted, enriched, suppressed } as const;
}
