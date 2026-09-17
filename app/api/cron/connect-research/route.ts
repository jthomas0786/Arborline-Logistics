import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { contactEnrichmentProvider, enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";
import { runNativeContactEnrichment } from "@/lib/connect-native-enrichment";
import { researchQualifiedProspects } from "@/lib/connect-public-research";
import { prepareConnectOutreachDrafts } from "@/lib/connect-outreach-drafts";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-research";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-research.yml@refs/heads/main`;
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 12;

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtClaims = Record<string, unknown>;
type GithubJwk = Record<string, unknown> & { kid?: string; kty?: string };

function parseJwtPart<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function audienceMatches(value: unknown) {
  if (typeof value === "string") return value === GITHUB_OIDC_AUDIENCE;
  return Array.isArray(value) && value.some((item) => item === GITHUB_OIDC_AUDIENCE);
}

function researchBatchSize(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)));
}

async function verifyGithubActionsOidc(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = parseJwtPart<JwtHeader>(headerPart);
  const claims = parseJwtPart<JwtClaims>(claimsPart);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return false;

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp ?? 0);
  const nbf = Number(claims.nbf ?? 0);
  const iat = Number(claims.iat ?? 0);
  if (!exp || exp < now - 30) return false;
  if (nbf && nbf > now + 30) return false;
  if (iat && iat > now + 60) return false;
  if (claims.iss !== GITHUB_OIDC_ISSUER) return false;
  if (!audienceMatches(claims.aud)) return false;
  if (claims.repository !== GITHUB_REPOSITORY) return false;
  if (claims.repository_owner !== "jthomas0786") return false;
  if (claims.ref !== "refs/heads/main") return false;
  if (claims.workflow_ref !== GITHUB_WORKFLOW_REF) return false;
  if (!["schedule", "workflow_dispatch", "push"].includes(String(claims.event_name ?? ""))) return false;

  try {
    const response = await fetch(GITHUB_OIDC_JWKS, {
      headers: { accept: "application/json", "user-agent": "ArborLine-Research-OIDC/1.0" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
    if (!response.ok) return false;
    const body = await response.json() as { keys?: GithubJwk[] };
    const jwk = body.keys?.find((item) => item.kid === header.kid && item.kty === "RSA");
    if (!jwk) return false;
    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    return verify(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${claimsPart}`),
      publicKey,
      Buffer.from(signaturePart, "base64url")
    );
  } catch {
    return false;
  }
}

async function authorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET?.trim();
  if (expected && authorization === `Bearer ${expected}`) return true;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? verifyGithubActionsOidc(match[1]) : false;
}

async function internalClientId() {
  const { rows } = await getPool().query(
    `SELECT id
     FROM connect_clients
     WHERE lower(company_name)=lower($1)
       AND status IN ('READY','ACTIVE','ONBOARDING')
     ORDER BY created_at ASC
     LIMIT 1`,
    ["ArborLine Connect"]
  );
  return String(rows[0]?.id ?? "").trim();
}

async function selectResearchSegment(
  clientId: string,
  requestedSlug: string | null,
  enrichmentProvider: "PROSPEO" | "HUNTER" | "NONE"
) {
  const { rows } = await getPool().query(
    `WITH segment_work AS (
       SELECT
         p.segment_id,
         count(*) FILTER (
           WHERE p.contact_email IS NULL
             AND p.domain IS NOT NULL
             AND (
               p.qualification_status='QUALIFIED'
               OR (
                 p.qualification_status='REVIEW'
                 AND coalesce(p.qualification_score,0) >= 60
                 AND p.source='ARBORLINE_DISCOVERY'
               )
               OR (
                 p.source='ARBORLINE_DISCOVERY'
                 AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
               )
             )
             AND (
               NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
               OR (
                 p.source='ARBORLINE_DISCOVERY'
                 AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
               )
             )
         )::int AS research_backlog,
         count(*) FILTER (
           WHERE p.qualification_status='QUALIFIED'
             AND p.contact_email IS NULL
             AND p.contact_name IS NOT NULL
             AND p.domain IS NOT NULL
             AND p.suppression_status='CLEAR'
             AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
             AND coalesce(p.source_metadata->'native_contact_enrichment'->>'checked_at','')=''
         )::int AS native_enrichment_backlog,
         count(*) FILTER (
           WHERE p.qualification_status='QUALIFIED'
             AND p.enrichment_status='PARTIAL'
             AND p.contact_email IS NULL
             AND p.domain IS NOT NULL
             AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
             AND (
               ($3::text='PROSPEO' AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'prospeo_no_match_at'))
               OR ($3::text='HUNTER' AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'hunter_no_match_at'))
             )
         )::int AS enrichment_backlog,
         count(*) FILTER (
           WHERE p.source='ARBORLINE_DISCOVERY'
             AND p.contact_email IS NULL
             AND p.domain IS NOT NULL
             AND coalesce(p.source_metadata->'service_fit'->>'status','')=''
         )::int AS service_fit_backlog
       FROM connect_prospects p
       WHERE p.client_id=$1
       GROUP BY p.segment_id
     )
     SELECT s.id,s.name,s.slug,
            coalesce(w.research_backlog,0)::int AS research_backlog,
            coalesce(w.native_enrichment_backlog,0)::int AS native_enrichment_backlog,
            coalesce(w.enrichment_backlog,0)::int AS enrichment_backlog,
            coalesce(w.service_fit_backlog,0)::int AS service_fit_backlog
     FROM connect_prospect_segments s
     LEFT JOIN segment_work w ON w.segment_id=s.id
     WHERE s.client_id=$1
       AND s.status IN ('APPROVED','ACTIVE')
       AND ($2::text IS NULL OR s.slug=$2)
       AND (coalesce(w.research_backlog,0) + coalesce(w.native_enrichment_backlog,0) + coalesce(w.enrichment_backlog,0)) > 0
     ORDER BY coalesce(w.service_fit_backlog,0) DESC,
              coalesce(w.research_backlog,0) DESC,
              coalesce(w.native_enrichment_backlog,0) DESC,
              coalesce(w.enrichment_backlog,0) DESC,
              s.slug ASC
     LIMIT 1`,
    [clientId, requestedSlug, enrichmentProvider]
  );
  return rows[0] ?? null;
}

async function promoteVerifiedContacts(clientId: string, segmentId: string) {
  const result = await getPool().query(
    `UPDATE connect_prospects p
     SET outreach_status='READY',updated_at=now()
     WHERE p.client_id=$1
       AND p.segment_id=$2
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.suppression_status='CLEAR'
       AND p.outreach_status='NOT_READY'
       AND p.contact_email IS NOT NULL
       AND (
         (
           upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='PROSPEO'
           AND upper(coalesce(p.source_metadata->>'email_status',''))='VERIFIED'
         )
         OR (
           upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='HUNTER'
           AND upper(coalesce(p.source_metadata->>'email_status','')) IN ('VALID','VERIFIED')
         )
         OR (
           lower(coalesce(p.source_metadata->'hunter_verification'->>'status',''))='valid'
           AND lower(coalesce(p.source_metadata->'hunter_verification'->>'email',''))=lower(p.contact_email)
         )
         OR lower(coalesce(p.source_metadata->'hunter_email_finder'->>'verification_status','')) IN ('valid','verified')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     RETURNING p.id`,
    [clientId, segmentId]
  );

  return { verifiedPromoted: result.rowCount ?? 0, unverifiedPublishedPromoted: 0 };
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  const clientId = await internalClientId();
  if (!clientId) {
    return NextResponse.json({ error: "Internal ArborLine Connect client was not found." }, { status: 503 });
  }

  const url = new URL(request.url);
  const requestedSlug = url.searchParams.get("segment")?.trim().toLowerCase() || null;
  const batchSize = researchBatchSize(url.searchParams.get("batch"));
  const enrichmentProvider = contactEnrichmentProvider();
  const segment = await selectResearchSegment(clientId, requestedSlug, enrichmentProvider);
  if (!segment) {
    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_RESEARCH_QUEUE",
      state: "NO_WORK",
      requestedSegment: requestedSlug,
      batchSize,
      enrichmentProvider,
      nativeEnrichmentProvider: "ARBORLINE_NATIVE",
      ranAt: startedAt.toISOString()
    }, { headers: { "cache-control": "no-store" } });
  }

  const researchBacklogBefore = Number(segment.research_backlog || 0);
  const nativeEnrichmentBacklogBefore = Number(segment.native_enrichment_backlog || 0);
  const enrichmentBacklogBefore = Number(segment.enrichment_backlog || 0);
  const research = researchBacklogBefore > 0
    ? await researchQualifiedProspects(clientId, batchSize, String(segment.id))
    : {
        status: "COMPLETED" as const,
        provider: "ARBORLINE_RESEARCH" as const,
        attempted: 0,
        candidates: 0,
        highConfidenceCandidates: 0,
        publishedEmailCandidates: 0,
        blocked: 0,
        errors: 0,
        qualifiedAfterResearch: 0,
        segmentId: String(segment.id),
        sendReadyPromoted: 0
      };

  const nativeEnrichment = (nativeEnrichmentBacklogBefore > 0 || research.qualifiedAfterResearch > 0)
    ? await runNativeContactEnrichment(clientId, batchSize, String(segment.id))
    : {
        status: "COMPLETED" as const,
        provider: "ARBORLINE_NATIVE" as const,
        attempted: 0,
        candidatesStored: 0,
        publishedCandidates: 0,
        learnedPatternCandidates: 0,
        mxValid: 0,
        patternsAvailable: 0,
        providerFallbackRecommended: 0,
        mailboxVerified: 0,
        contactsPromoted: 0,
        outreachPromoted: false
      };

  const enrichment = enrichmentProvider !== "NONE" && (enrichmentBacklogBefore > 0 || research.qualifiedAfterResearch > 0)
    ? await enrichQualifiedProspects(clientId, batchSize, String(segment.id))
    : {
        status: enrichmentProvider === "NONE" ? "NEEDS_PROVIDER" as const : "COMPLETED" as const,
        attempted: 0,
        enriched: 0,
        suppressed: 0,
        noMatch: 0
      };

  const promotions = await promoteVerifiedContacts(clientId, String(segment.id));
  const drafts = await prepareConnectOutreachDrafts(clientId, Math.max(10, batchSize), String(segment.id));

  return NextResponse.json({
    ok: true,
    engine: "ARBORLINE_RESEARCH_QUEUE",
    state: "COMPLETED",
    segment: {
      id: segment.id,
      name: segment.name,
      slug: segment.slug,
      researchBacklogBefore,
      nativeEnrichmentBacklogBefore,
      enrichmentBacklogBefore,
      serviceFitBacklogBefore: Number(segment.service_fit_backlog || 0)
    },
    batchSize,
    research,
    nativeEnrichment,
    enrichment,
    promotions,
    drafts,
    safety: {
      verifiedContactGate: true,
      nativeMxOnlyPromoted: 0,
      nativeMailboxVerified: nativeEnrichment.mailboxVerified,
      unverifiedPublishedEmailsPromoted: 0,
      outreachPromoted: false,
      sendReadyPromoted: 0,
      draftsOnly: true,
      approvalsCreated: 0,
      queuedCreated: 0,
      messagesSent: 0
    },
    ranAt: startedAt.toISOString()
  }, { headers: { "cache-control": "no-store" } });
}
