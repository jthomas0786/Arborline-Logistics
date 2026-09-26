import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  runDeepDecisionMakerWorker,
  runDeepNativeCandidateWorker,
  runDeepPublishedEmailWorker
} from "@/lib/connect-deep-research-workers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-deep-research";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-deep-research.yml@refs/heads/main`;

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
      headers: { accept: "application/json", "user-agent": "ArborLine-Deep-Research-OIDC/1.0" },
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
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? verifyGithubActionsOidc(match[1]) : false;
}

async function internalClientId() {
  const { rows } = await getPool().query(
    `SELECT id FROM connect_clients
     WHERE lower(company_name)=lower($1)
       AND status IN ('READY','ACTIVE','ONBOARDING')
     ORDER BY created_at ASC
     LIMIT 1`,
    ["ArborLine Connect"]
  );
  return String(rows[0]?.id ?? "").trim();
}

function boundedLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const clientId = await internalClientId();
  if (!clientId) {
    return NextResponse.json({ error: "Internal ArborLine Connect client was not found." }, { status: 503 });
  }

  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") ?? "").trim().toLowerCase();
  const startedAt = new Date().toISOString();

  try {
    const result = mode === "decision-maker"
      ? await runDeepDecisionMakerWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6), url.searchParams.get("prospectId"))
      : mode === "published-email"
        ? await runDeepPublishedEmailWorker(clientId, boundedLimit(url.searchParams.get("limit"), 2, 6))
        : mode === "native-candidates"
          ? await runDeepNativeCandidateWorker(clientId, boundedLimit(url.searchParams.get("limit"), 20, 50))
          : null;

    if (!result) {
      return NextResponse.json({ error: "Unknown deep research worker mode." }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_DEEP_RESEARCH_V1",
      mode,
      result,
      safety: {
        publicSourcesOnly: true,
        providerSpendEnabled: false,
        providerCallsMade: 0,
        mailboxPromotionRequiresExistingVerifier: true,
        outreachApprovalsCreated: 0,
        outreachQueuedCreated: 0,
        messagesSent: 0
      },
      startedAt,
      completedAt: new Date().toISOString()
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      engine: "ARBORLINE_DEEP_RESEARCH_V1",
      mode,
      error: error instanceof Error ? error.message : "Deep research worker failed.",
      startedAt,
      completedAt: new Date().toISOString()
    }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
