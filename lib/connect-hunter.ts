import { getPool } from "@/lib/db";

const HUNTER_BASE_URL = "https://api.hunter.io/v2";

export class HunterApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HunterApiError";
  }
}

type HunterUsageBucket = {
  used?: number | null;
  available?: number | null;
  remaining?: number | null;
};

type HunterAccountResponse = {
  data?: {
    plan_name?: string | null;
    reset_date?: string | null;
    requests?: {
      credits?: HunterUsageBucket | null;
      searches?: HunterUsageBucket | null;
      verifications?: HunterUsageBucket | null;
    } | null;
  } | null;
};

type HunterFinderResponse = {
  data?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    score?: number | null;
    domain?: string | null;
    accept_all?: boolean | null;
    position?: string | null;
    linkedin_url?: string | null;
    sources?: unknown[] | null;
    verification?: {
      status?: string | null;
      date?: string | null;
    } | null;
  } | null;
  meta?: {
    credits_charged?: number | null;
  } | null;
};

function hunterKey() {
  return process.env.HUNTER_API_KEY?.trim() || "";
}

export function hunterConfigured() {
  return Boolean(hunterKey());
}

function normalizeDomain(value: string | null | undefined) {
  const clean = (value ?? "").trim().toLowerCase();
  if (!clean) return "";
  return clean
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

function emailMatchesCompanyDomain(email: string, domain: string) {
  const emailDomain = normalizeDomain(email.split("@")[1]);
  const companyDomain = normalizeDomain(domain);
  return Boolean(emailDomain && companyDomain && (emailDomain === companyDomain || emailDomain.endsWith(`.${companyDomain}`)));
}

function minimumHunterScore() {
  const value = Number(process.env.HUNTER_MIN_CONFIDENCE ?? 80);
  if (!Number.isFinite(value)) return 80;
  return Math.max(50, Math.min(100, Math.floor(value)));
}

async function hunterGet<T>(path: string, params?: Record<string, string>) {
  const key = hunterKey();
  if (!key) throw new HunterApiError(503, "HUNTER_API_KEY is not configured.");

  const url = new URL(`${HUNTER_BASE_URL}/${path.replace(/^\//, "")}`);
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value) url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store"
  });

  const json = await response.json().catch(() => ({})) as T & { errors?: Array<{ details?: string; id?: string }> };
  if (!response.ok) {
    const detail = Array.isArray(json.errors) && json.errors[0]
      ? String(json.errors[0].details || json.errors[0].id || "Hunter request failed")
      : "Hunter request failed";
    throw new HunterApiError(response.status, `${detail} (${response.status}).`);
  }
  return json as T;
}

export async function getHunterAccountSummary() {
  if (!hunterConfigured()) {
    return {
      configured: false,
      connected: false,
      planName: null,
      resetDate: null,
      credits: null,
      searches: null,
      verifications: null
    } as const;
  }

  const response = await hunterGet<HunterAccountResponse>("account");
  const requests = response.data?.requests;
  return {
    configured: true,
    connected: true,
    planName: response.data?.plan_name ?? null,
    resetDate: response.data?.reset_date ?? null,
    credits: requests?.credits ?? null,
    searches: requests?.searches ?? null,
    verifications: requests?.verifications ?? null
  } as const;
}

export type HunterProspectResult =
  | { status: "FOUND"; prospectId: string; email: string; score: number; creditsCharged: number }
  | { status: "NOT_FOUND"; prospectId: string; creditsCharged: number }
  | { status: "LOW_CONFIDENCE"; prospectId: string; email: string; score: number; minimumScore: number; creditsCharged: number }
  | { status: "DOMAIN_MISMATCH"; prospectId: string; email: string; score: number; creditsCharged: number }
  | { status: "SUPPRESSED"; prospectId: string; score: number; creditsCharged: number }
  | { status: "INELIGIBLE"; prospectId: string; reason: string };

export async function findProspectEmailWithHunter(prospectId: string): Promise<HunterProspectResult> {
  const pool = getPool();
  const prospectResult = await pool.query(
    `SELECT id,client_id,company_name,domain,contact_name,contact_title,contact_email,
            qualification_status,suppression_status,outreach_status
     FROM connect_prospects
     WHERE id=$1
     LIMIT 1`,
    [prospectId]
  );
  const prospect = prospectResult.rows[0];
  if (!prospect) return { status: "INELIGIBLE", prospectId, reason: "Prospect not found." };
  if (prospect.contact_email) return { status: "INELIGIBLE", prospectId, reason: "Prospect already has an email." };
  if (prospect.qualification_status !== "QUALIFIED") return { status: "INELIGIBLE", prospectId, reason: "Prospect is not qualified." };
  if (prospect.suppression_status !== "CLEAR") return { status: "INELIGIBLE", prospectId, reason: "Prospect is suppressed." };
  if (!prospect.domain || !prospect.contact_name) return { status: "INELIGIBLE", prospectId, reason: "Decision-maker name and company domain are required." };

  const response = await hunterGet<HunterFinderResponse>("email-finder", {
    domain: String(prospect.domain),
    full_name: String(prospect.contact_name)
  });

  const creditsCharged = Number(response.meta?.credits_charged || 0);
  const email = String(response.data?.email || "").trim().toLowerCase();
  const score = Math.max(0, Math.min(100, Number(response.data?.score || 0)));
  if (!email) {
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=coalesce(source_metadata,'{}'::jsonb) || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [prospectId, JSON.stringify({
        hunter_email_finder: {
          status: "NOT_FOUND",
          checked_at: new Date().toISOString(),
          credits_charged: creditsCharged
        }
      })]
    );
    return { status: "NOT_FOUND", prospectId, creditsCharged };
  }

  const metadata = {
    contact_enrichment_provider: "HUNTER",
    hunter_email_finder: {
      status: "FOUND",
      score,
      accept_all: response.data?.accept_all ?? null,
      provider_position: response.data?.position ?? null,
      linkedin_url: response.data?.linkedin_url ?? null,
      verification_status: response.data?.verification?.status ?? "finder_verified",
      verification_date: response.data?.verification?.date ?? null,
      sources_count: Array.isArray(response.data?.sources) ? response.data?.sources?.length : 0,
      credits_charged: creditsCharged,
      checked_at: new Date().toISOString()
    }
  };

  if (!emailMatchesCompanyDomain(email, String(prospect.domain))) {
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=coalesce(source_metadata,'{}'::jsonb) || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [prospectId, JSON.stringify({ ...metadata, contact_validation_rejected: true, contact_validation_reason: "Hunter email did not match the company domain." })]
    );
    return { status: "DOMAIN_MISMATCH", prospectId, email, score, creditsCharged };
  }

  const minScore = minimumHunterScore();
  if (score < minScore) {
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=coalesce(source_metadata,'{}'::jsonb) || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [prospectId, JSON.stringify({ ...metadata, contact_validation_rejected: true, contact_validation_reason: `Hunter confidence ${score} was below the ${minScore} minimum.` })]
    );
    return { status: "LOW_CONFIDENCE", prospectId, email, score, minimumScore: minScore, creditsCharged };
  }

  const blocked = await pool.query(
    `SELECT 1 FROM connect_suppressions
     WHERE (client_id IS NULL OR client_id=$1)
       AND ((email IS NOT NULL AND lower(email)=lower($2))
         OR (domain IS NOT NULL AND lower(domain)=lower($3)))
     LIMIT 1`,
    [prospect.client_id, email, prospect.domain]
  );

  if (blocked.rowCount) {
    await pool.query(
      `UPDATE connect_prospects
       SET suppression_status='DO_NOT_CONTACT',qualification_status='SUPPRESSED',outreach_status='STOPPED',
           source_metadata=coalesce(source_metadata,'{}'::jsonb) || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [prospectId, JSON.stringify({ ...metadata, hunter_suppression_match: true })]
    );
    return { status: "SUPPRESSED", prospectId, score, creditsCharged };
  }

  await pool.query(
    `UPDATE connect_prospects
     SET contact_email=$2,
         contact_name=coalesce(contact_name,$3),
         contact_title=coalesce(contact_title,$4),
         enrichment_status='ENRICHED',
         outreach_status=CASE WHEN qualification_status='QUALIFIED' AND suppression_status='CLEAR' THEN 'READY' ELSE outreach_status END,
         source_metadata=coalesce(source_metadata,'{}'::jsonb) || $5::jsonb,
         updated_at=now()
     WHERE id=$1 AND contact_email IS NULL`,
    [
      prospectId,
      email,
      [response.data?.first_name, response.data?.last_name].filter(Boolean).join(" ") || null,
      response.data?.position?.trim() || null,
      JSON.stringify({ ...metadata, title_validated: Boolean(prospect.contact_title), domain_validated: true })
    ]
  );

  return { status: "FOUND", prospectId, email, score, creditsCharged };
}
