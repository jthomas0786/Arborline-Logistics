import { getPool } from "@/lib/db";
import { apolloConfigured, sourceFromApollo, type ApolloCandidate } from "@/lib/connect-apollo-source";

export type FreeSampleRequest = {
  id: string;
  company_name?: string | null;
  industry?: string | null;
  service_area?: string | null;
  target_customer?: string | null;
  decision_maker_titles?: string | null;
};

export type FreeSampleSearchCriteria = {
  target_industries: string[];
  target_geographies: string[];
  facility_types: string[];
  decision_maker_titles: string[];
  min_employees: null;
  max_employees: null;
  buying_signals: string[];
};

type ScoredCandidate = ApolloCandidate & {
  match_score: number;
  match_reasons: string[];
};

const STOP_WORDS = new Set([
  "and","the","for","with","within","near","around","from","that","their","our","your","into","who","are","is","of","to","in","on",
  "business","businesses","company","companies","customer","customers","client","clients","service","services","looking","need","needs","want","wants"
]);

function unique(values: string[], limit: number) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, limit);
}

function targetPhrases(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n|;|,|\band\b/gi)
    .map(part => part
      .replace(/^(businesses|companies|customers|clients)\s+(that\s+)?/i, "")
      .replace(/\b(with|within)\s+\d.*$/i, "")
      .replace(/[.]+$/g, "")
      .trim())
    .filter(part => part.length >= 3 && part.length <= 90);
  if (parts.length) return unique(parts, 8);
  return [raw.slice(0, 90)];
}

function geographies(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return unique(raw.split(/\n|;/g).map(part => part.trim()), 8);
}

function titles(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return unique(raw.split(/\n|;|,/g).map(part => part.trim()), 12);
}

export function deriveFreeSampleSearchCriteria(request: FreeSampleRequest): FreeSampleSearchCriteria {
  const targets = targetPhrases(request.target_customer);
  return {
    target_industries: targets,
    target_geographies: geographies(request.service_area),
    facility_types: targets,
    decision_maker_titles: titles(request.decision_maker_titles),
    min_employees: null,
    max_employees: null,
    buying_signals: []
  };
}

export function freeSampleProvider() {
  return apolloConfigured() ? "APOLLO" : "NONE";
}

export function freeSampleProviderSpendEnabled() {
  return process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED === "true";
}

function normalized(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function keywords(value: string) {
  return new Set(normalized(value).split(" ").filter(token => token.length >= 3 && !STOP_WORDS.has(token)));
}

function looseMatch(expected: string, actual: string) {
  const left = normalized(expected);
  const right = normalized(actual);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function scoreCandidate(candidate: ApolloCandidate, criteria: FreeSampleSearchCriteria): ScoredCandidate {
  const reasons: string[] = [];
  const targetText = [...criteria.target_industries, ...criteria.facility_types].join(" ");
  const candidateText = [candidate.company_name, candidate.industry, candidate.domain, candidate.website].filter(Boolean).join(" ");
  const expectedTokens = keywords(targetText);
  const candidateTokens = keywords(candidateText);
  const overlap = [...expectedTokens].filter(token => candidateTokens.has(token)).length;
  const phraseMatched = criteria.target_industries.some(value => looseMatch(value, candidate.industry || candidate.company_name));
  const denominator = Math.max(1, Math.min(expectedTokens.size, 5));
  const targetScore = phraseMatched ? 50 : Math.min(50, Math.round((overlap / denominator) * 50));
  if (targetScore > 0) reasons.push(phraseMatched ? "Strong target-category match" : `${overlap} target keyword${overlap === 1 ? "" : "s"} matched`);

  const location = [candidate.city, candidate.state, candidate.country].filter(Boolean).join(", ");
  const nationwide = criteria.target_geographies.some(value => /nationwide|united states|\busa\b|\bu\.s\.?\b/i.test(value));
  const geographyMatched = nationwide || criteria.target_geographies.length === 0 || criteria.target_geographies.some(value => looseMatch(value, location));
  const geographyScore = geographyMatched ? 25 : 0;
  if (geographyMatched && location) reasons.push(`Location: ${location}`);
  else if (criteria.target_geographies.length > 0) reasons.push("Location needs staff review");

  const websiteScore = candidate.domain || candidate.website ? 10 : 0;
  if (websiteScore) reasons.push("Company domain available");

  const industryScore = candidate.industry ? 10 : 0;
  if (candidate.industry) reasons.push(`Industry: ${candidate.industry}`);

  const employeeScore = candidate.employee_count != null ? 5 : 0;
  if (candidate.employee_count != null) reasons.push(`${candidate.employee_count} employees`);

  return {
    ...candidate,
    match_score: Math.min(100, targetScore + geographyScore + websiteScore + industryScore + employeeScore),
    match_reasons: reasons.slice(0, 5)
  };
}

function candidateKey(candidate: ApolloCandidate) {
  const domain = normalized(candidate.domain || candidate.website);
  if (domain) return `domain:${domain}`;
  return `name:${normalized(candidate.company_name)}:${normalized(candidate.city)}:${normalized(candidate.state)}`;
}

export async function generateFreeSampleMatches(requestId: string) {
  if (!freeSampleProviderSpendEnabled()) throw new Error("PROVIDER_SPEND_DISABLED");
  if (!apolloConfigured()) throw new Error("SAMPLE_PROVIDER_NOT_CONFIGURED");

  const pool = getPool();
  const requestResult = await pool.query(
    `SELECT id,company_name,industry,service_area,target_customer,decision_maker_titles,sample_status
     FROM connect_pilot_interest
     WHERE id=$1 AND request_type='FREE_SAMPLE'
     LIMIT 1`,
    [requestId]
  );
  const request = requestResult.rows[0] as (FreeSampleRequest & { sample_status?: string }) | undefined;
  if (!request) throw new Error("SAMPLE_REQUEST_NOT_FOUND");
  if (!new Set(["REQUESTED","READY"]).has(String(request.sample_status || ""))) {
    throw new Error(String(request.sample_status) === "IN_PROGRESS" ? "SAMPLE_GENERATION_ALREADY_RUNNING" : "SAMPLE_GENERATION_NOT_ALLOWED");
  }

  const criteria = deriveFreeSampleSearchCriteria(request);
  if (!criteria.target_industries.length) throw new Error("SAMPLE_TARGET_REQUIRED");

  const claimed = await pool.query(
    `UPDATE connect_pilot_interest
     SET sample_status='IN_PROGRESS',sample_provider='APOLLO',sample_search_criteria=$2::jsonb,
         sample_generation_error=NULL,updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_status IN ('REQUESTED','READY')
     RETURNING id`,
    [requestId, JSON.stringify(criteria)]
  );
  if (!claimed.rows[0]) throw new Error("SAMPLE_GENERATION_ALREADY_RUNNING");

  try {
    const candidates = await sourceFromApollo(criteria);
    const deduped: ApolloCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.company_name?.trim()) continue;
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(candidate);
    }

    const ranked = deduped
      .map(candidate => scoreCandidate(candidate, criteria))
      .sort((a, b) => b.match_score - a.match_score || String(a.company_name).localeCompare(String(b.company_name)))
      .slice(0, 5);

    if (!ranked.length) throw new Error("SAMPLE_PROVIDER_RETURNED_NO_MATCHES");

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM connect_free_sample_matches WHERE request_id=$1", [requestId]);
      for (let index = 0; index < ranked.length; index++) {
        const candidate = ranked[index];
        await db.query(
          `INSERT INTO connect_free_sample_matches
           (request_id,rank,company_name,website,domain,industry,city,state,country,employee_count,source,source_url,match_score,match_reasons,selected)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,true)`,
          [
            requestId,index + 1,candidate.company_name,candidate.website || null,candidate.domain || null,candidate.industry || null,
            candidate.city || null,candidate.state || null,candidate.country || "US",candidate.employee_count ?? null,candidate.source || "APOLLO",
            candidate.source_url || null,candidate.match_score,JSON.stringify(candidate.match_reasons)
          ]
        );
      }
      await db.query(
        `UPDATE connect_pilot_interest
         SET sample_status='READY',sample_prepared_at=COALESCE(sample_prepared_at,now()),sample_generated_at=now(),
             sample_provider='APOLLO',sample_search_criteria=$2::jsonb,sample_generation_error=NULL,updated_at=now()
         WHERE id=$1 AND request_type='FREE_SAMPLE'`,
        [requestId, JSON.stringify(criteria)]
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }

    return { count: ranked.length, provider: "APOLLO" as const, criteria };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown sample generation error";
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_status='REQUESTED',sample_generation_error=$2,updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE'`,
      [requestId, message]
    );
    throw error;
  }
}
