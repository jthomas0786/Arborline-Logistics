import { resolveMx } from "node:dns/promises";
import { getPool } from "@/lib/db";

type EmailPattern =
  | "FIRST.LAST"
  | "FIRST_LAST"
  | "FIRST-LAST"
  | "FIRSTLAST"
  | "F_LAST"
  | "F.LAST"
  | "FIRST";

type MxStatus = "VALID" | "MISSING" | "TEMPORARY_ERROR" | "UNKNOWN";
type NativeEmailStatus = "PUBLISHED_UNVERIFIED" | "INFERRED_UNVERIFIED" | "SYNTAX_VALID" | "MX_VALID";

const NAME_HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "madam"]);
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

type NativeCandidate = {
  email: string;
  sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
  emailStatus: NativeEmailStatus;
  emailConfidence: number;
  pattern: EmailPattern | null;
  sourceUrl: string | null;
  evidence: string[];
};

type MxResult = { status: MxStatus; hosts: string[] };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function normalizeNamePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function nameParts(value: string | null | undefined) {
  const parts = (value ?? "")
    .trim()
    .split(/\s+/)
    .map(normalizeNamePart)
    .filter((part) => part && !NAME_HONORIFICS.has(part) && !NAME_SUFFIXES.has(part));
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function patternAddress(name: string, domain: string, pattern: EmailPattern) {
  const parts = nameParts(name);
  if (!parts) return null;
  const { first, last } = parts;
  const local = pattern === "FIRST.LAST" ? `${first}.${last}`
    : pattern === "FIRST_LAST" ? `${first}_${last}`
      : pattern === "FIRST-LAST" ? `${first}-${last}`
        : pattern === "FIRSTLAST" ? `${first}${last}`
          : pattern === "F_LAST" ? `${first[0]}${last}`
            : pattern === "F.LAST" ? `${first[0]}.${last}`
              : first;
  return `${local}@${domain}`;
}

function derivePattern(name: string, email: string, domain: string): EmailPattern | null {
  const normalized = email.trim().toLowerCase();
  if (normalizeDomain(normalized.split("@")[1]) !== domain) return null;
  const patterns: EmailPattern[] = ["FIRST.LAST", "FIRST_LAST", "FIRST-LAST", "FIRSTLAST", "F_LAST", "F.LAST", "FIRST"];
  return patterns.find((pattern) => patternAddress(name, domain, pattern) === normalized) ?? null;
}

function validEmailSyntax(email: string) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email);
}

function sameCompanyDomain(email: string, domain: string) {
  const emailDomain = normalizeDomain(email.split("@")[1]);
  const expected = normalizeDomain(domain);
  return Boolean(emailDomain && expected && (emailDomain === expected || emailDomain.endsWith(`.${expected}`)));
}

function emailLooksLikeName(email: string, name: string) {
  const parts = nameParts(name);
  if (!parts) return false;
  const local = normalizeNamePart(email.split("@")[0] ?? "");
  if (!local) return false;
  if (local.includes(parts.last) && (local.includes(parts.first) || local.startsWith(parts.first[0] ?? ""))) return true;
  if (local.length >= 4 && (parts.first.startsWith(local) || local.startsWith(parts.first))) return true;
  return false;
}

function providerVerified(metadataValue: unknown, email: string) {
  const metadata = asObject(metadataValue);
  const provider = String(metadata.contact_enrichment_provider ?? "").toUpperCase();
  const status = String(metadata.email_status ?? "").toUpperCase();
  if (provider === "PROSPEO" && status === "VERIFIED") return true;
  if (provider === "HUNTER" && ["VALID", "VERIFIED"].includes(status)) return true;

  const hunterVerification = asObject(metadata.hunter_verification);
  if (
    String(hunterVerification.status ?? "").toLowerCase() === "valid" &&
    String(hunterVerification.email ?? "").toLowerCase() === email.toLowerCase()
  ) return true;

  const hunterFinder = asObject(metadata.hunter_email_finder);
  return ["valid", "verified", "finder_verified"].includes(
    String(hunterFinder.verification_status ?? "").toLowerCase()
  );
}

async function resolveDomainMx(domain: string): Promise<MxResult> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MX_TIMEOUT")), 3500))
    ]);
    const hosts = records
      .filter((record) => Boolean(record.exchange))
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange.toLowerCase());
    return hosts.length ? { status: "VALID", hosts } : { status: "MISSING", hosts: [] };
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? "");
    if (["ENODATA", "ENOTFOUND", "ENOENT"].includes(code)) return { status: "MISSING", hosts: [] };
    if (["ETIMEOUT", "EAI_AGAIN"].includes(code) || (error instanceof Error && error.message === "MX_TIMEOUT")) {
      return { status: "TEMPORARY_ERROR", hosts: [] };
    }
    return { status: "UNKNOWN", hosts: [] };
  }
}

async function learnVerifiedPatterns(clientId: string, domain: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id,contact_name,contact_email,source_metadata
     FROM connect_prospects
     WHERE client_id=$1
       AND lower(domain)=lower($2)
       AND contact_name IS NOT NULL
       AND contact_email IS NOT NULL`,
    [clientId, domain]
  );

  const counts = new Map<EmailPattern, number>();
  for (const row of rows) {
    const email = String(row.contact_email ?? "").trim().toLowerCase();
    const name = String(row.contact_name ?? "").trim();
    if (!email || !name || !providerVerified(row.source_metadata, email)) continue;
    const pattern = derivePattern(name, email, domain);
    if (!pattern) continue;
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);

    await pool.query(
      `INSERT INTO connect_email_verification_cache
         (client_id,email,domain,syntax_valid,mx_status,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
       VALUES ($1,$2,$3,true,'UNKNOWN','NOT_CHECKED',true,100,$4::jsonb,now(),now()+interval '180 days')
       ON CONFLICT (client_id,email) DO UPDATE
       SET domain=excluded.domain,syntax_valid=true,provider_verified=true,confidence=100,
           evidence=excluded.evidence,checked_at=now(),expires_at=excluded.expires_at`,
      [clientId, email, domain, JSON.stringify({ source: "EXISTING_VERIFIED_CONTACT", prospect_id: row.id })]
    );
  }

  for (const [pattern, samples] of counts) {
    const confidence = samples >= 3 ? 96 : samples === 2 ? 90 : 82;
    await pool.query(
      `INSERT INTO connect_domain_email_patterns
         (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
       ON CONFLICT (client_id,domain,pattern) DO UPDATE
       SET verified_samples=excluded.verified_samples,confidence=excluded.confidence,
           metadata=excluded.metadata,last_observed_at=now()`,
      [clientId, domain, pattern, samples, confidence, JSON.stringify({ source: "VERIFIED_CONTACT_HISTORY" })]
    );
  }
  return counts.size;
}

async function learnPublicObservedPatterns(clientId: string, domain: string, publicResearchValue: unknown) {
  const publicResearch = asObject(publicResearchValue);
  const raw = Array.isArray(publicResearch.public_email_pattern_observations)
    ? publicResearch.public_email_pattern_observations
    : [];
  const grouped = new Map<EmailPattern, { samples: number; maxConfidence: number }>();
  for (const item of raw) {
    const observation = asObject(item);
    const pattern = String(observation.pattern ?? "") as EmailPattern;
    if (!["FIRST.LAST","FIRST_LAST","FIRST-LAST","FIRSTLAST","F_LAST","F.LAST","FIRST"].includes(pattern)) continue;
    const email = String(observation.email ?? "").trim().toLowerCase();
    const name = String(observation.name ?? "").trim();
    if (!email || !name || !sameCompanyDomain(email, domain) || derivePattern(name, email, domain) !== pattern) continue;
    const confidence = Math.max(0, Math.min(100, Number(observation.confidence ?? 0) || 0));
    const current = grouped.get(pattern) ?? { samples: 0, maxConfidence: 0 };
    grouped.set(pattern, { samples: current.samples + 1, maxConfidence: Math.max(current.maxConfidence, confidence) });
  }

  for (const [pattern, observation] of grouped) {
    const confidence = Math.min(84, Math.max(72, observation.maxConfidence - 8 + Math.min(4, Math.max(0, observation.samples - 1) * 2)));
    await getPool().query(
      `INSERT INTO connect_domain_email_patterns
         (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
       VALUES ($1,$2,$3,0,$4,$5::jsonb,now())
       ON CONFLICT (client_id,domain,pattern) DO UPDATE
       SET confidence=GREATEST(connect_domain_email_patterns.confidence,excluded.confidence),
           metadata=coalesce(connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
           last_observed_at=now()`,
      [clientId, domain, pattern, confidence, JSON.stringify({
        source: "PUBLIC_PERSON_EMAIL_OBSERVATIONS",
        public_samples: observation.samples,
        mailbox_verified: false,
        version: 1
      })]
    );
  }
  return grouped.size;
}

async function bestPatterns(clientId: string, domain: string) {
  const { rows } = await getPool().query(
    `SELECT pattern,verified_samples,confidence
     FROM connect_domain_email_patterns
     WHERE client_id=$1 AND lower(domain)=lower($2)
     ORDER BY confidence DESC,verified_samples DESC,last_observed_at DESC
     LIMIT 3`,
    [clientId, domain]
  );
  return rows as Array<{ pattern: EmailPattern; verified_samples: number; confidence: number }>;
}

async function cacheEmailCheck(
  clientId: string,
  email: string,
  domain: string,
  syntaxValid: boolean,
  mx: MxResult,
  confidence: number,
  evidence: Record<string, unknown>
) {
  await getPool().query(
    `INSERT INTO connect_email_verification_cache
       (client_id,email,domain,syntax_valid,mx_status,mx_hosts,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'NOT_CHECKED',false,$7,$8::jsonb,now(),now()+interval '14 days')
     ON CONFLICT (client_id,email) DO UPDATE
     SET domain=excluded.domain,syntax_valid=excluded.syntax_valid,mx_status=excluded.mx_status,
         mx_hosts=excluded.mx_hosts,
         confidence=CASE WHEN connect_email_verification_cache.provider_verified THEN connect_email_verification_cache.confidence ELSE excluded.confidence END,
         evidence=CASE WHEN connect_email_verification_cache.provider_verified THEN connect_email_verification_cache.evidence ELSE excluded.evidence END,
         checked_at=now(),expires_at=excluded.expires_at`,
    [clientId, email, domain, syntaxValid, mx.status, JSON.stringify(mx.hosts), confidence, JSON.stringify(evidence)]
  );
}

async function upsertCandidate(input: {
  clientId: string;
  prospectId: string;
  segmentId: string | null;
  marketId: string | null;
  name: string;
  title: string | null;
  identityConfidence: number;
  candidate: NativeCandidate;
}) {
  const c = input.candidate;
  await getPool().query(
    `INSERT INTO connect_contact_candidates
       (client_id,prospect_id,segment_id,market_id,source_kind,contact_name,contact_title,email,
        identity_confidence,email_confidence,email_status,source_url,evidence,metadata,last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,now())
     ON CONFLICT (prospect_id,(lower(email))) WHERE email IS NOT NULL DO UPDATE
     SET source_kind=excluded.source_kind,contact_name=excluded.contact_name,contact_title=excluded.contact_title,
         identity_confidence=GREATEST(connect_contact_candidates.identity_confidence,excluded.identity_confidence),
         email_confidence=GREATEST(connect_contact_candidates.email_confidence,excluded.email_confidence),
         email_status=CASE
           WHEN connect_contact_candidates.email_status='VERIFIED' THEN 'VERIFIED'
           WHEN excluded.email_status='MX_VALID' THEN 'MX_VALID'
           ELSE excluded.email_status
         END,
         source_url=coalesce(excluded.source_url,connect_contact_candidates.source_url),
         evidence=excluded.evidence,metadata=excluded.metadata,last_seen_at=now()`,
    [
      input.clientId,
      input.prospectId,
      input.segmentId,
      input.marketId,
      c.sourceKind,
      input.name,
      input.title,
      c.email,
      input.identityConfidence,
      c.emailConfidence,
      c.emailStatus,
      c.sourceUrl,
      JSON.stringify(c.evidence),
      JSON.stringify({ pattern: c.pattern, native_engine_version: 1 })
    ]
  );
}

export async function runNativeContactEnrichment(clientId: string, limit = 20, segmentId?: string | null) {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 20)));
  const { rows } = await pool.query(
    `SELECT id,segment_id,market_id,domain,contact_name,contact_title,source_metadata
     FROM connect_prospects
     WHERE client_id=$1
       AND (($3::uuid IS NULL AND segment_id IS NULL) OR segment_id=$3)
       AND qualification_status='QUALIFIED'
       AND suppression_status='CLEAR'
       AND contact_email IS NULL
       AND contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(contact_name)
       AND domain IS NOT NULL
       AND (source <> 'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND (
         coalesce(source_metadata->'native_contact_enrichment'->>'checked_at','')=''
         OR (
           EXISTS (
             SELECT 1 FROM connect_prepared_outreach_drafts pd
             WHERE pd.prospect_id=connect_prospects.id AND pd.status='PREPARED'
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_contact_candidates cc
             WHERE cc.prospect_id=connect_prospects.id
               AND lower(cc.contact_name)=lower(connect_prospects.contact_name)
           )
         )
       )
     ORDER BY CASE WHEN EXISTS (
                SELECT 1 FROM connect_prepared_outreach_drafts pd
                WHERE pd.prospect_id=connect_prospects.id AND pd.status='PREPARED'
              ) THEN 0 ELSE 1 END,
              qualification_score DESC NULLS LAST,updated_at DESC
     LIMIT $2`,
    [clientId, safeLimit, segmentId ?? null]
  );

  let attempted = 0;
  let candidatesStored = 0;
  let publishedCandidates = 0;
  let learnedPatternCandidates = 0;
  let mxValid = 0;
  let patternsAvailable = 0;
  let providerFallbackRecommended = 0;
  const mxCache = new Map<string, MxResult>();

  for (const row of rows) {
    attempted++;
    const domain = normalizeDomain(String(row.domain ?? ""));
    const name = String(row.contact_name ?? "").trim();
    if (!domain || !name) continue;

    await learnVerifiedPatterns(clientId, domain);
    const metadata = asObject(row.source_metadata);
    const publicResearch = asObject(metadata.public_research);
    await learnPublicObservedPatterns(clientId, domain, publicResearch);
    const patterns = await bestPatterns(clientId, domain);
    if (patterns.length) patternsAvailable++;

    const manualProfileResearch = asObject(metadata.manual_public_profile_research);
    const publicIdentityConfidence = Number(publicResearch.decision_maker_confidence ?? 0) || 0;
    const manualIdentityConfidence = manualProfileResearch.decision_maker_name ? 98 : 0;
    const identityConfidence = Math.max(0, Math.min(100, Math.max(publicIdentityConfidence, manualIdentityConfidence)));
    const publicSourceKind = String(publicResearch.decision_maker_source_kind ?? "").toUpperCase() === "PUBLIC_PROFILE"
      ? "PUBLIC_PROFILE" as const
      : "PUBLIC_SITE" as const;
    const sourceUrl = typeof publicResearch.source_url === "string"
      ? publicResearch.source_url
      : typeof manualProfileResearch.profile_url === "string"
        ? manualProfileResearch.profile_url
        : null;
    const profilePublished = typeof manualProfileResearch.published_email === "string"
      ? manualProfileResearch.published_email.trim().toLowerCase()
      : "";
    const sitePublished = typeof publicResearch.published_email === "string"
      ? publicResearch.published_email.trim().toLowerCase()
      : "";
    const rawPublished = profilePublished || sitePublished;
    const publishedSourceKind = profilePublished ? "PUBLIC_PROFILE" as const : publicSourceKind;
    const inferred = Array.isArray(publicResearch.inferred_email_candidates)
      ? publicResearch.inferred_email_candidates.map(String).map((value) => value.trim().toLowerCase()).filter(Boolean)
      : [];

    const proposed = new Map<string, {
      sourceKind: "PUBLIC_SITE" | "PUBLIC_PROFILE" | "LEARNED_PATTERN";
      pattern: EmailPattern | null;
      baseConfidence: number;
      evidence: string[];
    }>();

    if (rawPublished && sameCompanyDomain(rawPublished, domain) && emailLooksLikeName(rawPublished, name)) {
      proposed.set(rawPublished, {
        sourceKind: publishedSourceKind,
        pattern: derivePattern(name, rawPublished, domain),
        baseConfidence: publishedSourceKind === "PUBLIC_PROFILE" ? 81 : 74,
        evidence: [
          publishedSourceKind === "PUBLIC_PROFILE"
            ? "Email is published on a public business/social profile tied to the company and matches the researched decision-maker first-name pattern."
            : "Email is published on the company website and matches the researched decision-maker name."
        ]
      });
      publishedCandidates++;
    }

    for (const learned of patterns) {
      const email = patternAddress(name, domain, learned.pattern);
      if (!email || proposed.has(email)) continue;
      proposed.set(email, {
        sourceKind: "LEARNED_PATTERN",
        pattern: learned.pattern,
        baseConfidence: Math.min(76, Math.max(60, Number(learned.confidence || 0) - 16)),
        evidence: [`Email follows ${learned.pattern}, learned from ${learned.verified_samples} verified contact${Number(learned.verified_samples) === 1 ? "" : "s"} on this company domain.`]
      });
      learnedPatternCandidates++;
    }

    for (const email of inferred.slice(0, 4)) {
      const inferredPattern = derivePattern(name, email, domain);
      if (!sameCompanyDomain(email, domain) || proposed.has(email) || !inferredPattern) continue;
      proposed.set(email, {
        sourceKind: "LEARNED_PATTERN",
        pattern: inferredPattern,
        baseConfidence: 44,
        evidence: ["Email is an ArborLine-generated same-domain candidate derived from the researched decision-maker name."]
      });
    }

    if (!proposed.size) {
      const conservativeDefaults: EmailPattern[] = ["FIRST.LAST", "F_LAST", "FIRSTLAST"];
      for (const pattern of conservativeDefaults) {
        const email = patternAddress(name, domain, pattern);
        if (!email || proposed.has(email)) continue;
        proposed.set(email, {
          sourceKind: "LEARNED_PATTERN",
          pattern,
          baseConfidence: 44,
          evidence: ["Email is a conservative ArborLine same-domain pattern candidate for a qualified, person-like decision-maker. Mailbox verification is still required before use."]
        });
      }
    }

    const mx = mxCache.get(domain) ?? await resolveDomainMx(domain);
    mxCache.set(domain, mx);
    let best: NativeCandidate | null = null;

    for (const [email, proposal] of proposed) {
      const syntaxValid = validEmailSyntax(email);
      if (!syntaxValid) continue;
      const status: NativeEmailStatus = mx.status === "VALID"
        ? "MX_VALID"
        : ["PUBLIC_SITE","PUBLIC_PROFILE"].includes(proposal.sourceKind)
          ? "PUBLISHED_UNVERIFIED"
          : "SYNTAX_VALID";
      const confidence = Math.max(0, Math.min(89, proposal.baseConfidence + (mx.status === "VALID" ? 8 : 0)));
      const candidate: NativeCandidate = {
        email,
        sourceKind: proposal.sourceKind,
        emailStatus: status,
        emailConfidence: confidence,
        pattern: proposal.pattern,
        sourceUrl,
        evidence: [
          ...proposal.evidence,
          mx.status === "VALID"
            ? "Company domain has valid MX records; mailbox existence is not yet verified."
            : `MX status is ${mx.status}; mailbox existence is not verified.`
        ]
      };

      await cacheEmailCheck(clientId, email, domain, syntaxValid, mx, confidence, {
        source: proposal.sourceKind,
        pattern: proposal.pattern,
        mailbox_verified: false
      });
      await upsertCandidate({
        clientId,
        prospectId: String(row.id),
        segmentId: row.segment_id ? String(row.segment_id) : null,
        marketId: row.market_id ? String(row.market_id) : null,
        name,
        title: row.contact_title ? String(row.contact_title) : null,
        identityConfidence,
        candidate
      });
      candidatesStored++;
      if (status === "MX_VALID") mxValid++;
      if (!best || candidate.emailConfidence > best.emailConfidence) best = candidate;
    }

    // Native v1 never promotes a candidate to the prospect record. MX proves the
    // domain receives mail, not that this specific mailbox exists. Until ArborLine
    // owns mailbox-level verification, every unresolved prospect stays behind the
    // external verification fallback and the existing human-approval send gate.
    providerFallbackRecommended++;
    await pool.query(
      `UPDATE connect_prospects
       SET source_metadata=coalesce(source_metadata,'{}'::jsonb) || $2::jsonb,updated_at=now()
       WHERE id=$1`,
      [row.id, JSON.stringify({
        native_contact_enrichment: {
          checked_at: new Date().toISOString(),
          engine_version: 1,
          best_candidate_email: best?.email ?? null,
          best_candidate_status: best?.emailStatus ?? "NONE",
          best_candidate_confidence: best?.emailConfidence ?? 0,
          mailbox_verified: false,
          provider_fallback_recommended: true
        }
      })]
    );
  }

  return {
    status: "COMPLETED" as const,
    provider: "ARBORLINE_NATIVE" as const,
    attempted,
    candidatesStored,
    publishedCandidates,
    learnedPatternCandidates,
    mxValid,
    patternsAvailable,
    providerFallbackRecommended,
    mailboxVerified: 0,
    contactsPromoted: 0,
    outreachPromoted: false
  };
}
