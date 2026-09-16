import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { dispatchConnectQueuedOutreach, previewConnectQueuedOutreach } from "@/lib/connect-outreach-send";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-outreach";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-outreach.yml@refs/heads/main`;
const RECOVERY_KEY = "2026-09-16-approved-landscaping";

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
      headers: { accept: "application/json", "user-agent": "ArborLine-Outreach-OIDC/1.0" },
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

function chicagoHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

function chicagoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function ensureInternalAutosendClient() {
  if (process.env.CONNECT_AUTOSEND_CLIENT_IDS?.trim()) return;
  const { rows } = await getPool().query(
    `SELECT id
     FROM connect_clients
     WHERE lower(company_name)=lower($1)
       AND status IN ('READY','ACTIVE','ONBOARDING')
     ORDER BY created_at ASC
     LIMIT 1`,
    ["ArborLine Connect"]
  );
  const clientId = String(rows[0]?.id ?? "").trim();
  if (clientId) process.env.CONNECT_AUTOSEND_CLIENT_IDS = clientId;
}

async function validateRecoveryQueue() {
  const result = await getPool().query(
    `SELECT count(*)::int AS count,
            bool_and(seg.slug='landscaping') AS all_landscaping
     FROM connect_outreach_messages m
     JOIN connect_prospects p ON p.id=m.prospect_id
     LEFT JOIN connect_prospect_segments seg ON seg.id=p.segment_id
     WHERE m.status='QUEUED'
       AND m.provider_message_id IS NULL
       AND p.qualification_status='QUALIFIED'
       AND p.outreach_status='QUEUED'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NOT NULL
       AND lower(p.contact_email)=lower(m.recipient_email)`
  );
  return {
    count: Number(result.rows[0]?.count || 0),
    allLandscaping: result.rows[0]?.all_landscaping === true
  };
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  const localHour = chicagoHour(startedAt);
  const localDate = chicagoDate(startedAt);
  const url = new URL(request.url);
  const recoveryRequested = url.searchParams.get("recovery") === RECOVERY_KEY;
  const recoveryAllowed = recoveryRequested && localDate === "2026-09-16";
  await ensureInternalAutosendClient();

  if (localHour !== 9 && !recoveryAllowed) {
    const preview = await previewConnectQueuedOutreach();
    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_OUTREACH_DISPATCH",
      skipped: true,
      reason: "Scheduled outreach only dispatches during the 9 AM America/Chicago hour.",
      preview,
      schedule: { timeZone: "America/Chicago", localHour, dispatchHour: 9, scheduler: "github-actions-oidc" },
      ranAt: startedAt.toISOString()
    }, { headers: { "cache-control": "no-store" } });
  }

  if (recoveryAllowed) {
    const queue = await validateRecoveryQueue();
    if (queue.count < 1 || queue.count > 10 || !queue.allLandscaping) {
      return NextResponse.json({
        error: "Recovery queue safety check failed.",
        queue,
        ranAt: startedAt.toISOString()
      }, { status: 409 });
    }
    // User explicitly approved sending the remaining ten on 2026-09-16.
    // This override expires with the date gate and does not change tomorrow's normal limits.
    process.env.CONNECT_DAILY_SEND_LIMIT = "15";
    process.env.CONNECT_AUTOSEND_BATCH_LIMIT = "7";
  }

  process.env.CONNECT_AUTOSEND_ENABLED = "true";
  const preview = await previewConnectQueuedOutreach();
  const result = await dispatchConnectQueuedOutreach();
  const ok = result.state === "ACTIVE" && result.failed === 0;

  return NextResponse.json({
    ok,
    engine: "ARBORLINE_OUTREACH_DISPATCH",
    recovery: recoveryAllowed,
    preview,
    result,
    schedule: { timeZone: "America/Chicago", localHour, dispatchHour: 9, scheduler: "github-actions-oidc" },
    ranAt: startedAt.toISOString()
  }, {
    status: ok ? 200 : 502,
    headers: { "cache-control": "no-store" }
  });
}
