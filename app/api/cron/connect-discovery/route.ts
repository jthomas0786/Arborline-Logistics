import { createPublicKey, verify } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { runPublicDiscoveryCycle } from "@/lib/connect-public-discovery";

export const dynamic = "force-dynamic";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-discovery";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-discovery.yml@refs/heads/main`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      headers: { accept: "application/json", "user-agent": "ArborLine-Discovery-OIDC/1.0" },
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

async function ensureInternalDiscoveryClient() {
  if (process.env.CONNECT_PUBLIC_DISCOVERY_CLIENT_IDS?.trim() || process.env.CONNECT_AUTOSEND_CLIENT_IDS?.trim()) return;
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
  if (clientId) process.env.CONNECT_PUBLIC_DISCOVERY_CLIENT_IDS = clientId;
}

function discoveryClientIds() {
  const raw = process.env.CONNECT_PUBLIC_DISCOVERY_CLIENT_IDS?.trim()
    || process.env.CONNECT_AUTOSEND_CLIENT_IDS?.trim()
    || "";
  return [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => UUID.test(value)))];
}

async function rotationDateForOverride(segmentSlug: string, geography: string, now: Date) {
  const clientIds = discoveryClientIds();
  if (!clientIds.length) return null;

  const { rows } = await getPool().query(
    `SELECT s.client_id,s.slug,s.target_geographies
     FROM connect_prospect_segments s
     JOIN connect_clients c ON c.id=s.client_id
     WHERE s.status='ACTIVE'
       AND c.status IN ('READY','ACTIVE','ONBOARDING')
       AND s.client_id=ANY($1::uuid[])
     ORDER BY s.client_id,s.slug`,
    [clientIds]
  );

  const slots = rows.flatMap((row) =>
    (Array.isArray(row.target_geographies) ? row.target_geographies : [])
      .map((value: unknown) => String(value))
      .map((value: string) => ({ slug: String(row.slug), geography: value }))
  );
  const targetIndex = slots.findIndex((slot) =>
    slot.slug.toLowerCase() === segmentSlug.toLowerCase()
      && slot.geography.toLowerCase() === geography.toLowerCase()
  );
  if (targetIndex < 0 || !slots.length) return null;

  const epochHour = Math.floor(now.getTime() / 3_600_000);
  const currentIndex = ((epochHour % slots.length) + slots.length) % slots.length;
  const deltaHours = (targetIndex - currentIndex + slots.length) % slots.length;
  return {
    rotationAt: new Date((epochHour + deltaHours) * 3_600_000),
    slotIndex: targetIndex,
    slotCount: slots.length
  };
}

// Discovery is intentionally isolated from the outreach sender: this route can
// discover, dedupe, score, and research companies, but it cannot send email.
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  await ensureInternalDiscoveryClient();

  const url = new URL(request.url);
  const segment = url.searchParams.get("segment")?.trim() || null;
  const geography = url.searchParams.get("geography")?.trim() || null;
  if (Boolean(segment) !== Boolean(geography)) {
    return NextResponse.json({ error: "segment and geography must be supplied together." }, { status: 400 });
  }

  let rotationAt = startedAt;
  let override: { segment: string; geography: string; slotIndex: number; slotCount: number } | null = null;
  if (segment && geography) {
    const target = await rotationDateForOverride(segment, geography, startedAt);
    if (!target) {
      return NextResponse.json({ error: "Requested active discovery slot was not found." }, { status: 400 });
    }
    rotationAt = target.rotationAt;
    override = { segment, geography, slotIndex: target.slotIndex, slotCount: target.slotCount };
  }

  const result = await runPublicDiscoveryCycle(rotationAt);
  const status = result.state === "FAILED" ? 502 : 200;
  return NextResponse.json({
    ok: result.state !== "FAILED",
    engine: "ARBORLINE_PUBLIC_DISCOVERY",
    result,
    validationOverride: override,
    schedule: {
      cadence: "hourly",
      scheduler: "github-actions-oidc",
      mode: "rotating active segment/geography slot",
      outreachSeparated: true
    },
    ranAt: startedAt.toISOString()
  }, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
