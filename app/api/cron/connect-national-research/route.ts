import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  coordinateNationalResearch,
  getNationalWorkerHealth,
  processNationalResearchJobs
} from "@/lib/connect-national-worker-fleet";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-national-research";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-national-research.yml@refs/heads/main`;

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
      headers: { accept: "application/json", "user-agent": "ArborLine-National-Research-OIDC/1.0" },
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

function safeLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(0, Math.min(20, Math.floor(parsed)));
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
  const shouldCoordinate = url.searchParams.get("coordinate") !== "0";
  const limit = safeLimit(url.searchParams.get("limit"));
  const workerId = (url.searchParams.get("worker")?.trim() || "national-research-cron").slice(0, 120);

  try {
    const coordinator = shouldCoordinate
      ? await coordinateNationalResearch(clientId)
      : { skipped: true };
    const workers = limit > 0
      ? await processNationalResearchJobs({ limit, workerId })
      : { workerId, claimed: 0, succeeded: 0, retried: 0, blocked: 0, failed: 0, jobs: [] };
    const health = await getNationalWorkerHealth(clientId);

    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_NATIONAL_RESEARCH",
      coordinator,
      workers,
      health,
      safety: {
        marketsAutoActivated: false,
        providerSpendRequiresExplicitSwitches: true,
        nativeMxOnlyPromoted: 0,
        outreachApproved: false,
        outreachQueued: 0,
        messagesSent: 0
      },
      ranAt: startedAt.toISOString()
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "National research cron failed.",
      ranAt: startedAt.toISOString()
    }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
