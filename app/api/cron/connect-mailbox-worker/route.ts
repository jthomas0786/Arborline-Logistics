import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { claimMailboxWorkerCandidate, finalizeMailboxWorkerCandidate } from "@/lib/connect-mailbox-worker-protocol";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-mailbox";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-mailbox-verifier.yml@refs/heads/main`;
const WORKER_HEADER = "x-arborline-mailbox-worker";

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

async function authorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1];
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
  if (claims.repository !== GITHUB_REPOSITORY || claims.repository_owner !== "jthomas0786") return false;
  if (claims.ref !== "refs/heads/main" || claims.workflow_ref !== GITHUB_WORKFLOW_REF) return false;
  if (!["schedule", "workflow_dispatch", "push"].includes(String(claims.event_name ?? ""))) return false;

  try {
    const response = await fetch(GITHUB_OIDC_JWKS, {
      headers: { accept: "application/json", "user-agent": "ArborLine-Mailbox-OIDC/1.0" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
    if (!response.ok) return false;
    const body = await response.json() as { keys?: GithubJwk[] };
    const jwk = body.keys?.find((item) => item.kid === header.kid && item.kty === "RSA");
    if (!jwk) return false;
    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    return verify("RSA-SHA256", Buffer.from(`${headerPart}.${claimsPart}`), publicKey, Buffer.from(signaturePart, "base64url"));
  } catch {
    return false;
  }
}

function workerId(request: Request) {
  const value = request.headers.get(WORKER_HEADER)?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const worker = workerId(request);
  if (!worker) return NextResponse.json({ error: `Valid ${WORKER_HEADER} header required.` }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const action = String(body.action ?? "").toLowerCase();
  try {
    if (action === "claim") {
      const requestedLane = String(body.lane ?? "fresh").toLowerCase();
      if (!["fresh", "retry"].includes(requestedLane)) {
        return NextResponse.json({ error: "Mailbox lane must be fresh or retry." }, { status: 400 });
      }
      const lane = requestedLane as "fresh" | "retry";
      const candidate = await claimMailboxWorkerCandidate(worker, lane);
      return NextResponse.json({ ok: true, action: "claim", lane, candidate }, { headers: { "cache-control": "no-store" } });
    }

    if (action === "result") {
      const candidateId = String(body.candidate_id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(candidateId)) return NextResponse.json({ error: "Valid candidate_id required." }, { status: 400 });
      const claimId = String(body.claim_id ?? "").trim();
      if (claimId && !/^[0-9a-f-]{36}$/i.test(claimId)) return NextResponse.json({ error: "Valid claim_id required when provided." }, { status: 400 });
      const result = await finalizeMailboxWorkerCandidate({
        candidateId,
        workerId: worker,
        claimId: claimId || null,
        mxHost: typeof body.mx_host === "string" ? body.mx_host.slice(0, 255) : null,
        tlsUsed: body.tls_used === true,
        durationMs: Number(body.duration_ms ?? 0),
        networkError: typeof body.network_error === "string" ? body.network_error : null,
        targetCode: Number.isFinite(Number(body.target_code)) ? Number(body.target_code) : null,
        targetText: typeof body.target_text === "string" ? body.target_text : null,
        controlCode: Number.isFinite(Number(body.control_code)) ? Number(body.control_code) : null,
        controlText: typeof body.control_text === "string" ? body.control_text : null
      });
      return NextResponse.json({ ok: true, action: "result", result }, { headers: { "cache-control": "no-store" } });
    }

    return NextResponse.json({ error: "Unsupported mailbox worker action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mailbox worker request failed." }, { status: 500 });
  }
}
