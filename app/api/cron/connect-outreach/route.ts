import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { prepareDueConnectFollowUpDrafts } from "@/lib/connect-outreach-followups";
import { dispatchConnectQueuedOutreach, previewConnectQueuedOutreach } from "@/lib/connect-outreach-send";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-outreach";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-outreach.yml@refs/heads/main`;
const INVOCATION_HEADER = "x-arborline-invocation-id";
const MANUAL_SEND_HEADER = "x-arborline-manual-send";

type JwtHeader = { alg?: unknown; kid?: unknown };
type JwtClaims = Record<string, unknown>;
type GithubJwk = Record<string, unknown> & { kid?: string; kty?: string };
type InvocationRow = {
  invocation_key: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  response_status: number | null;
  response_json: unknown;
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

function schedulerSource(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET?.trim();
  return expected && authorization === `Bearer ${expected}` ? "vercel-cron" : "github-actions-oidc";
}

function chicagoHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

function chicagoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function scheduledWindow(localHour: number, scheduler: string) {
  if (scheduler === "vercel-cron") {
    if ([9, 10].includes(localHour)) return "09";
    if ([13, 14].includes(localHour)) return "13";
    return null;
  }
  if (localHour === 9) return "09";
  if (localHour === 13) return "13";
  return null;
}

function invocationKey(request: Request, startedAt: Date, manualRequested: boolean, windowKey: string | null) {
  const supplied = request.headers.get(INVOCATION_HEADER)?.trim() ?? "";
  if (supplied && !/^[A-Za-z0-9._:-]{1,160}$/.test(supplied)) return null;

  if (manualRequested) return supplied ? `manual-${supplied}` : null;
  if (!windowKey) return null;
  return `scheduled-${chicagoDateKey(startedAt)}-${windowKey}`;
}

async function claimInvocation(key: string) {
  const pool = getPool();
  const inserted = await pool.query<InvocationRow>(
    `INSERT INTO connect_outreach_invocations (invocation_key,status)
     VALUES ($1,'RUNNING')
     ON CONFLICT (invocation_key) DO NOTHING
     RETURNING invocation_key,status,response_status,response_json`,
    [key]
  );
  if (inserted.rows[0]) return { claimed: true as const, row: inserted.rows[0] };

  const existing = await pool.query<InvocationRow>(
    `SELECT invocation_key,status,response_status,response_json
     FROM connect_outreach_invocations
     WHERE invocation_key=$1
     LIMIT 1`,
    [key]
  );
  return { claimed: false as const, row: existing.rows[0] ?? null };
}

async function finishInvocation(
  key: string,
  status: "COMPLETED" | "FAILED",
  responseStatus: number,
  responseBody: Record<string, unknown>
) {
  await getPool().query(
    `UPDATE connect_outreach_invocations
     SET status=$2,response_status=$3,response_json=$4::jsonb,completed_at=now(),updated_at=now()
     WHERE invocation_key=$1 AND status='RUNNING'`,
    [key, status, responseStatus, JSON.stringify(responseBody)]
  );
}

function cachedBody(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  const localHour = chicagoHour(startedAt);
  const scheduler = schedulerSource(request);
  const manualRequested = scheduler === "github-actions-oidc" &&
    request.headers.get(MANUAL_SEND_HEADER)?.trim().toLowerCase() === "true";
  await ensureInternalAutosendClient();

  const windowKey = scheduledWindow(localHour, scheduler);
  if (!manualRequested && !windowKey) {
    const preview = await previewConnectQueuedOutreach();
    return NextResponse.json({
      ok: true,
      engine: "ARBORLINE_OUTREACH_DISPATCH",
      skipped: true,
      reason: "This scheduler invocation is outside its approved America/Chicago dispatch windows.",
      preview,
      schedule: { timeZone: "America/Chicago", localHour, dispatchHours: [9, 13], scheduler, manualRequested },
      ranAt: startedAt.toISOString()
    }, { headers: { "cache-control": "no-store" } });
  }

  const key = invocationKey(request, startedAt, manualRequested, windowKey);
  if (!key) {
    return NextResponse.json({
      ok: false,
      error: manualRequested
        ? `Manual outreach requires a valid ${INVOCATION_HEADER} header.`
        : `Invalid ${INVOCATION_HEADER} header or dispatch window.`
    }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const invocation = await claimInvocation(key);
  if (!invocation.claimed) {
    if (!invocation.row || invocation.row.status === "RUNNING") {
      return NextResponse.json({
        ok: true,
        engine: "ARBORLINE_OUTREACH_DISPATCH",
        skipped: true,
        reason: "This outreach invocation has already been claimed. A second dispatch was not started.",
        idempotency: { invocationKey: key, replayed: true, state: invocation.row?.status ?? "UNKNOWN" },
        ranAt: startedAt.toISOString()
      }, { status: 202, headers: { "cache-control": "no-store" } });
    }

    const originalStatus = invocation.row.response_status && invocation.row.response_status >= 100
      ? invocation.row.response_status
      : invocation.row.status === "COMPLETED" ? 200 : 502;
    return NextResponse.json({
      ...cachedBody(invocation.row.response_json),
      idempotency: { invocationKey: key, replayed: true, state: invocation.row.status }
    }, { status: originalStatus, headers: { "cache-control": "no-store" } });
  }

  process.env.CONNECT_AUTOSEND_ENABLED = "true";

  try {
    let followUps: Record<string, unknown>;
    try {
      followUps = await prepareDueConnectFollowUpDrafts(100);
    } catch {
      followUps = {
        eligible: 0,
        draftsCreated: 0,
        approvalsCreated: 0,
        messagesQueued: 0,
        messagesSent: 0,
        error: "Follow-up draft preparation failed safely; no follow-up was approved or sent."
      };
    }

    const preview = await previewConnectQueuedOutreach();
    const result = await dispatchConnectQueuedOutreach();
    const ok = result.state === "ACTIVE" && result.failed === 0;
    const responseStatus = ok ? 200 : 502;
    const responseBody: Record<string, unknown> = {
      ok,
      engine: "ARBORLINE_OUTREACH_DISPATCH",
      followUps,
      preview,
      result,
      schedule: {
        timeZone: "America/Chicago",
        localHour,
        dispatchHours: [9, 13],
        logicalWindow: manualRequested ? "manual" : windowKey,
        fallbackHour: scheduler === "vercel-cron"
          ? windowKey === "09" ? 10 : windowKey === "13" ? 14 : null
          : null,
        scheduler,
        manualRequested
      },
      idempotency: { invocationKey: key, replayed: false, state: ok ? "COMPLETED" : "FAILED" },
      ranAt: startedAt.toISOString()
    };

    await finishInvocation(key, ok ? "COMPLETED" : "FAILED", responseStatus, responseBody);
    return NextResponse.json(responseBody, {
      status: responseStatus,
      headers: { "cache-control": "no-store" }
    });
  } catch {
    const responseBody: Record<string, unknown> = {
      ok: false,
      engine: "ARBORLINE_OUTREACH_DISPATCH",
      error: "Outreach dispatch failed before a successful completion. This invocation will not be replayed automatically.",
      idempotency: { invocationKey: key, replayed: false, state: "FAILED" },
      ranAt: startedAt.toISOString()
    };
    await finishInvocation(key, "FAILED", 500, responseBody).catch(() => undefined);
    return NextResponse.json(responseBody, {
      status: 500,
      headers: { "cache-control": "no-store" }
    });
  }
}
