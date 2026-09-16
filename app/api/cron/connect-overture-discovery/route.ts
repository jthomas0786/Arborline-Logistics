import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ingestOvertureCandidates, type OvertureProspectCandidate } from "@/lib/connect-overture-ingest";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-overture";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-overture-discovery.yml@refs/heads/main`;

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtClaims = Record<string, unknown>;
type GithubJwk = Record<string, unknown> & { kid?: string; kty?: string };

type Body = {
  segment?: unknown;
  geography?: unknown;
  region?: unknown;
  candidates?: unknown;
};

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
      headers: { accept: "application/json", "user-agent": "ArborLine-Overture-OIDC/1.0" },
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
    `SELECT id FROM connect_clients
     WHERE lower(company_name)=lower($1)
       AND status IN ('READY','ACTIVE','ONBOARDING')
     ORDER BY created_at ASC LIMIT 1`,
    ["ArborLine Connect"]
  );
  return String(rows[0]?.id ?? "").trim() || null;
}

function cleanCandidates(value: unknown): OvertureProspectCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    const website = String(row.website ?? "").trim();
    if (!id || !name || !website) return [];
    return [{
      id: id.slice(0, 180),
      name: name.slice(0, 180),
      website: website.slice(0, 500),
      city: row.city == null ? null : String(row.city).slice(0, 100),
      confidence: row.confidence == null ? null : Number(row.confidence),
      basicCategory: row.basicCategory == null ? null : String(row.basicCategory).slice(0, 160),
      taxonomy: Array.isArray(row.taxonomy) ? row.taxonomy.map(String).slice(0, 20) : []
    }];
  });
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const segment = String(body.segment ?? "").trim().toLowerCase();
  const geography = String(body.geography ?? "").trim();
  const region = String(body.region ?? "").trim().slice(0, 120);
  const candidates = cleanCandidates(body.candidates);
  if (!segment || !geography || !region) {
    return NextResponse.json({ error: "segment, geography, and region are required." }, { status: 400 });
  }

  const clientId = await internalClientId();
  if (!clientId) return NextResponse.json({ error: "Internal ArborLine client is not available." }, { status: 409 });

  const result = await ingestOvertureCandidates({ clientId, segmentSlug: segment, geography, region, candidates });
  return NextResponse.json({
    ok: result.state !== "FAILED",
    engine: "ARBORLINE_PUBLIC_OVERTURE",
    result,
    safety: {
      discoveryOnly: true,
      contactEmailsCreated: 0,
      approvalsCreated: 0,
      queuedCreated: 0,
      messagesSent: 0
    },
    ranAt: new Date().toISOString()
  }, {
    status: result.state === "FAILED" ? 502 : 200,
    headers: { "cache-control": "no-store" }
  });
}
