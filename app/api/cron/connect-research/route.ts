import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { researchQualifiedProspects } from "@/lib/connect-public-research";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-research";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-research.yml@refs/heads/main`;

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

async function selectResearchSegment(clientId: string, requestedSlug: string | null) {
  const pool = getPool();
  if (requestedSlug) {
    const { rows } = await pool.query(
      `SELECT s.id,s.name,s.slug,
              count(p.id)::int AS backlog
       FROM connect_prospect_segments s
       LEFT JOIN connect_prospects p
         ON p.segment_id=s.id
        AND p.client_id=s.client_id
        AND p.qualification_status='QUALIFIED'
        AND p.contact_email IS NULL
        AND p.domain IS NOT NULL
        AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
       WHERE s.client_id=$1
         AND s.slug=$2
         AND s.status IN ('APPROVED','ACTIVE')
       GROUP BY s.id,s.name,s.slug
       LIMIT 1`,
      [clientId, requestedSlug]
    );
    return rows[0] ?? null;
  }

  const { rows } = await pool.query(
    `SELECT s.id,s.name,s.slug,
            count(p.id)::int AS backlog
     FROM connect_prospect_segments s
     LEFT JOIN connect_prospects p
       ON p.segment_id=s.id
      AND p.client_id=s.client_id
      AND p.qualification_status='QUALIFIED'
      AND p.contact_email IS NULL
      AND p.domain IS NOT NULL
      AND NOT (coalesce(p.source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
     WHERE s.client_id=$1
       AND s.status IN ('APPROVED','ACTIVE')
     GROUP BY s.id,s.name,s.slug
     HAVING count(p.id) > 0
     ORDER BY count(p.id) DESC,s.slug ASC
     LIMIT 1`,
    [clientId]
  );
  return rows[0] ?? null;
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
  const segment = await selectResearchSegment(clientId, requestedSlug);
  if (!segment || Number(segment.backlog || 0) < 1) {
    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_RESEARCH_QUEUE",
      state: "NO_WORK",
      requestedSegment: requestedSlug,
      ranAt: startedAt.toISOString()
    }, { headers: { "cache-control": "no-store" } });
  }

  const result = await researchQualifiedProspects(clientId, 5, String(segment.id));
  return NextResponse.json({
    ok: true,
    engine: "ARBORLINE_RESEARCH_QUEUE",
    state: "COMPLETED",
    segment: { id: segment.id, name: segment.name, slug: segment.slug, backlogBefore: Number(segment.backlog || 0) },
    result,
    safety: { outreachPromoted: false, sendReadyPromoted: result.sendReadyPromoted },
    ranAt: startedAt.toISOString()
  }, { headers: { "cache-control": "no-store" } });
}
