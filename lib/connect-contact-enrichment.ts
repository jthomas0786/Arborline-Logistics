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

type HunterEmailRecord = {
  value?: string | null;
  confidence?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  position_raw?: string | null;
  verification?: {
    date?: string | null;
    status?: string | null;
  } | null;
};

type HunterDomainSearchResponse = {
  data?: {
    emails?: HunterEmailRecord[];
  } | null;
};

type EnrichmentMatch = {
  name: string | null;
  title: string | null;
  email: string;
  metadata: Record<string, unknown>;
};

class ProspeoApiError extends Error {
  constructor(public status: number, public code: string | null) {
    super(`Prospeo returned ${status}${code ? ` (${code})` : ""}.`);
    this.name = "ProspeoApiError";
  }
}

class HunterApiError extends Error {
  constructor(public status: number, public code: string | null) {
    super(`Hunter returned ${status}${code ? ` (${code})` : ""}.`);
    this.name = "HunterApiError";
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let lastProspeoSearchAt = 0;

function normalizeTitle(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[,&/()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesApprovedTitle(candidate: string | null | undefined, approvedTitles: string[]) {
  const target = normalizeTitle(candidate);
  if (!target) return false;

  return approvedTitles.some((value) => {
    const expected = normalizeTitle(value);
    if (!expected) return false;

    if (expected === "president") {
      return /\bpresident\b/.test(target) && !/\bvice president\b/.test(target);
    }
    if (expected === "owner") return /\bowner\b/.test(target);
    if (expected === "founder") return /\bfounder\b/.test(target);
    if (expected === "ceo") return /\bceo\b/.test(target) || target.includes("chief executive officer");
    if (expected === "coo" || expected === "chief operating officer") {
      return /\bcoo\b/.test(target) || target.includes("chief operating officer");
    }
    if (expected === "general manager") return /\bgeneral manager\b/.test(target);
    if (expected === "managing partner") return /\bmanaging partner\b/.test(target);
    if (expected === "vp sales" || expected === "vice president of sales") {
      return /\b(vp|vice president)\b/.test(target) && /\bsales\b/.test(target);
    }
    if (expected === "sales director") {
      return /\bdirector\b/.test(target) && /\bsales\b/.test(target);
    }
    if (expected === "sales manager") {
      return /\bmanager\b/.test(target) && /\bsales\b/.test(target);
    }
    if (expected === "director of business development") {
      return /\bdirector\b/.test(target) && target.includes("business development");
    }
    if (expected === "business development manager") {
      return /\bmanager\b/.test(target) && target.includes("business development");
    }
    if (expected === "director of operations") {
      return /\bdirector\b/.test(target) && /\boperations\b/.test(target);
    }

    return target === expected || target.includes(expected);
  });
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

function emailMatchesCompanyDomain(email: string, companyDomain: string) {
  const emailDomain = normalizeDomain(email.split("@")[1]);
  const expected = normalizeDomain(companyDomain);
  if (!emailDomain || !expected) return false;
  return emailDomain === expected || emailDomain.endsWith(`.${expected}`);
}

function hasHunterKey() {
  return Boolean(process.env.HUNTER_API_KEY?.trim());
}

export function contactEnrichmentProvider() {
  if (process.env.PROSPEO_API_KEY?.trim()) return "PROSPEO";
  if (hasHunterKey()) return "HUNTER";
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

async function hunterGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) throw new Error("HUNTER_API_KEY is not configured.");

  const url = new URL(`https://api.hunter.io/v2/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  const response = await fetch(url, {
    headers: { "X-API-KEY": key },
    signal: AbortSignal.timeout(30000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Array.isArray(json?.errors) ? json.errors[0] : null;
    const code = typeof firstError?.id === "string"
      ? firstError.id
      : typeof firstError?.code === "string"
        ? firstError.code
        : null;
    throw new HunterApiError(response.status, code);
  }
  return json as T;
}

async function enrichWithProspeo(domain: string, titles: string[]): Promise<EnrichmentMatch | null> {
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

  // Provider search can be broader than the requested title filters. Validate the
  // candidate locally before spending an enrich request on it.
  const candidate = search.results?.find(
    r => r.person?.person_id && matchesApprovedTitle(r.person.current_job_title, titles)
  )?.person;
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
  const resolvedTitle = enriched.person?.current_job_title?.trim() || candidate.current_job_title?.trim() || null;
  if (!email || enriched.person?.email?.status !== "VERIFIED" || enriched.person?.email?.revealed !== true) return null;
  if (!matchesApprovedTitle(resolvedTitle, titles)) return null;
  if (!emailMatchesCompanyDomain(email, domain)) return null;

  return {
    name: enriched.person?.full_name?.trim() || candidate.full_name?.trim() || null,
    title: resolvedTitle,
    email,
    metadata: {
      prospeo_person_id: candidate.person_id,
      email_status: "VERIFIED",
      title_validated: true,
      domain_validated: true
    }
  };
}

async function enrichWithHunter(domain: string, titles: string[]): Promise<EnrichmentMatch | null> {
  const search = await hunterGet<HunterDomainSearchResponse>("domain-search", {
    domain,
    type: "personal",
    seniority: "senior,executive",
    required_field: "position",
    verification_status: "valid",
    limit: "10"
  });

  const candidates = (search.data?.emails ?? [])
    .filter((item) => {
      const email = item.value?.trim().toLowerCase();
      const title = item.position_raw?.trim() || item.position?.trim() || null;
      return Boolean(
        email &&
        item.verification?.status === "valid" &&
        matchesApprovedTitle(title, titles) &&
        emailMatchesCompanyDomain(email, domain)
      );
    })
    .sort((left, right) => Number(right.confidence ?? 0) - Number(left.confidence ?? 0));

  const candidate = candidates[0];
  const email = candidate?.value?.trim().toLowerCase();
  const resolvedTitle = candidate?.position_raw?.trim() || candidate?.position?.trim() || null;
  if (!candidate || !email || !resolvedTitle) return null;

  // Domain Search was requested with verification_status=valid and the selected
  // candidate is independently checked for verification.status=valid above. Do not
  // spend a second Hunter verification credit on the same address.
  const name = [candidate.first_name?.trim(), candidate.last_name?.trim()].filter(Boolean).join(" ") || null;
  return {
    name,
    title: resolvedTitle,
    email,
    metadata: {
      email_status: "VALID",
      title_validated: true,
      domain_validated: true,
      hunter_confidence: Number(candidate.confidence ?? 0),
      verification_date: candidate.verification?.date ?? null,
      verification_source: "HUNTER_DOMAIN_SEARCH"
    }
  };
}

async function markNoMatch(prospectId: string, domain: string, provider: "PROSPEO" | "HUNTER") {
  const prefix = provider.toLowerCase();
  await getPool().query(
    `UPDATE connect_prospects
     SET source_metadata=coalesce(source_metadata,'{}'::jsonb) || jsonb_build_object(
       $2::text, true,
       $3::text, now()::text,
       $4::text, $5::text
     )
     WHERE id=$1`,
    [prospectId, `${prefix}_no_match`, `${prefix}_no_match_at`, `${prefix}_no_match_domain`, domain]
  );
}

export async function enrichQualifiedProspects(clientId: string, limit = 20, segmentId?: string | null) {
  const primaryProvider = contactEnrichmentProvider();
  if (primaryProvider === "NONE") return { status: "NEEDS_PROVIDER", attempted: 0, enriched: 0, suppressed: 0, noMatch: 0 } as const;

  const pool = getPool();
  const profileRows = segmentId
    ? await pool.query(`SELECT decision_maker_titles FROM connect_prospect_segments WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE') LIMIT 1`, [segmentId, clientId])
    : await pool.query(`SELECT decision_maker_titles FROM connect_icp_profiles WHERE client_id=$1`, [clientId]);
  const titles = Array.isArray(profileRows.rows[0]?.decision_maker_titles) ? profileRows.rows[0].decision_maker_titles.map(String).filter(Boolean) : [];
  if (!titles.length) throw new Error(segmentId ? "Prospect segment has no approved decision-maker titles." : "Client ICP has no decision-maker titles.");

  const { rows } = await pool.query(`SELECT id,domain,company_name FROM connect_prospects
    WHERE client_id=$1
      AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
      AND qualification_status='QUALIFIED'
      AND (source <> 'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
      AND enrichment_status='PARTIAL' AND contact_email IS NULL AND domain IS NOT NULL
      AND (($4::text='PROSPEO' AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'prospeo_no_match_at'))
        OR ($4::text='HUNTER' AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'hunter_no_match_at')))
    ORDER BY qualification_score DESC, created_at DESC LIMIT $2`,
    [clientId, Math.min(Math.max(limit, 1), 20), segmentId ?? null, primaryProvider]);

  let attempted = 0;
  let enriched = 0;
  let suppressed = 0;
  let noMatch = 0;
  let activeProvider: "PROSPEO" | "HUNTER" = primaryProvider;
  let fallbackUsed = false;

  for (const row of rows) {
    attempted++;
    let providerUsed = activeProvider;
    let found: EnrichmentMatch | null = null;

    if (activeProvider === "PROSPEO") {
      try {
        found = await enrichWithProspeo(String(row.domain), titles);
      } catch (error) {
        if (error instanceof ProspeoApiError && error.code === "INSUFFICIENT_CREDITS") {
          if (!hasHunterKey()) {
            return { status: "NEEDS_PROVIDER", reason: "PROSPEO_INSUFFICIENT_CREDITS", attempted, enriched, suppressed, noMatch, fallbackUsed } as const;
          }
          activeProvider = "HUNTER";
          providerUsed = "HUNTER";
          fallbackUsed = true;
          found = await enrichWithHunter(String(row.domain), titles);
        } else {
          throw error;
        }
      }
    } else {
      found = await enrichWithHunter(String(row.domain), titles);
    }

    if (!found) {
      noMatch++;
      await markNoMatch(String(row.id), String(row.domain), providerUsed);
      continue;
    }

    const blocked = await pool.query(`SELECT 1 FROM connect_suppressions
      WHERE (client_id IS NULL OR client_id=$1) AND ((email IS NOT NULL AND lower(email)=lower($2)) OR (domain IS NOT NULL AND lower(domain)=lower($3))) LIMIT 1`,
      [clientId, found.email, row.domain]);
    if (blocked.rowCount) {
      suppressed++;
      await pool.query(`UPDATE connect_prospects SET suppression_status='DO_NOT_CONTACT',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now() WHERE id=$1`, [row.id]);
      continue;
    }

    await pool.query(`UPDATE connect_prospects SET contact_name=$2,contact_title=$3,contact_email=$4,enrichment_status='ENRICHED',outreach_status='READY',source_metadata=(coalesce(source_metadata,'{}'::jsonb) - 'prospeo_no_match' - 'prospeo_no_match_at' - 'prospeo_no_match_domain' - 'hunter_no_match' - 'hunter_no_match_at' - 'hunter_no_match_domain') || $5::jsonb,updated_at=now() WHERE id=$1`,
      [row.id, found.name, found.title, found.email, JSON.stringify({ contact_enrichment_provider: providerUsed, segment_id: segmentId ?? null, ...found.metadata })]);
    enriched++;
  }

  return { status: "COMPLETED", attempted, enriched, suppressed, noMatch, primaryProvider, fallbackUsed, finalProvider: activeProvider } as const;
}
