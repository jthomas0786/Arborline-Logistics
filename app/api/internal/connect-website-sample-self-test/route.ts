import { createPublicKey, randomUUID, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { generatePublicFreeSampleMatches } from "@/lib/connect-public-free-sample";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-website-sample-self-test";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-website-sample-self-test.yml@refs/heads/main`;

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
  if (!["push", "workflow_dispatch"].includes(String(claims.event_name ?? ""))) return false;

  try {
    const response = await fetch(GITHUB_OIDC_JWKS, {
      headers: { accept: "application/json", "user-agent": "ArborLine-Website-Sample-Self-Test-OIDC/1.0" },
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const pool = getPool();
  const runId = randomUUID();
  const email = `website-sample-self-test-${runId}@example.invalid`;
  const company = `ArborLine Website Sample Self-Test ${runId}`;
  let requestId = "";
  let statusCode = 200;
  let result: Record<string,unknown> = {};

  try {
    await pool.query(
      `DELETE FROM connect_pilot_interest
       WHERE request_type='FREE_SAMPLE'
         AND source='CONTROLLED_WEBSITE_SAMPLE_SELF_TEST'
         AND created_at < now() - interval '10 minutes'`
    );

    const inserted = await pool.query(
      `INSERT INTO connect_pilot_interest
       (name,work_email,company_name,industry,service_area,website,notes,source,request_type,
        target_customer,decision_maker_titles,sample_status)
       VALUES ('Synthetic Website Buyer',$1,$2,'Commercial Cleaning','Chicago, IL','https://example.invalid',
         'Controlled website sample regression only.','CONTROLLED_WEBSITE_SAMPLE_SELF_TEST','FREE_SAMPLE',
         'Commercial property managers, medical offices, hotels, and professional buildings that purchase recurring janitorial services.',
         'Facilities Director, Property Manager, Operations Director','REQUESTED')
       RETURNING id,sample_status,sample_email_status,sample_approved_at,sample_email_sent_at`,
      [email,company]
    );
    const created = inserted.rows[0];
    requestId = String(created?.id || "");
    assert(requestId, "WEBSITE_SAMPLE_SELF_TEST_CREATE_FAILED");
    assert(created.sample_status === "REQUESTED", "WEBSITE_SAMPLE_SELF_TEST_NOT_REQUESTED");
    assert(!created.sample_approved_at && !created.sample_email_sent_at, "WEBSITE_SAMPLE_SELF_TEST_PREAPPROVED_OR_SENT");

    const generated = await generatePublicFreeSampleMatches(requestId);
    assert(generated.provider === "OPENSTREETMAP_OVERPASS", `WEBSITE_SAMPLE_SELF_TEST_PROVIDER_${generated.provider}`);
    assert(generated.paidProviderUsed === false, "WEBSITE_SAMPLE_SELF_TEST_PAID_PROVIDER_USED");
    assert(generated.count >= 3 && generated.count <= 5, `WEBSITE_SAMPLE_SELF_TEST_COUNT_${generated.count}`);

    const sampleResult = await pool.query(
      `SELECT sample_status,sample_provider,sample_approved_at,sample_email_status,sample_email_sent_at,
              sample_email_provider_message_id,sample_generation_error,sample_search_criteria
       FROM connect_pilot_interest WHERE id=$1 LIMIT 1`,
      [requestId]
    );
    const sample = sampleResult.rows[0];
    assert(sample?.sample_status === "READY", `WEBSITE_SAMPLE_SELF_TEST_NOT_READY_${sample?.sample_status || "NULL"}`);
    assert(sample?.sample_provider === "OPENSTREETMAP_OVERPASS", "WEBSITE_SAMPLE_SELF_TEST_WRONG_STORED_PROVIDER");
    assert(!sample?.sample_approved_at, "WEBSITE_SAMPLE_SELF_TEST_AUTO_APPROVED");
    assert(sample?.sample_email_status === "NOT_DRAFTED", `WEBSITE_SAMPLE_SELF_TEST_EMAIL_STATUS_${sample?.sample_email_status || "NULL"}`);
    assert(!sample?.sample_email_sent_at && !sample?.sample_email_provider_message_id, "WEBSITE_SAMPLE_SELF_TEST_EMAIL_SENT");

    const matchesResult = await pool.query(
      `SELECT rank,company_name,industry,city,state,match_score,source,source_url,selected
       FROM connect_free_sample_matches WHERE request_id=$1 ORDER BY rank`,
      [requestId]
    );
    const matches = matchesResult.rows;
    assert(matches.length >= 3 && matches.length <= 5, `WEBSITE_SAMPLE_SELF_TEST_STORED_MATCH_COUNT_${matches.length}`);
    assert(matches.every((row) => row.source === "OPENSTREETMAP_OVERPASS" && row.selected === true), "WEBSITE_SAMPLE_SELF_TEST_SOURCE_OR_SELECTION_FAILED");

    result = {
      ok: true,
      runId,
      stages: {
        websiteRequestCreated: true,
        sampleStatus: sample.sample_status,
        sampleProvider: sample.sample_provider,
        sampleMatchCount: matches.length,
        humanApprovalRequired: !sample.sample_approved_at,
        actualEmailSent: false
      },
      sampleMatches: matches.map((row) => ({
        rank: row.rank,
        companyName: row.company_name,
        industry: row.industry,
        city: row.city,
        state: row.state,
        score: row.match_score,
        publicSource: row.source_url
      })),
      safety: {
        syntheticRecipientDomain: "example.invalid",
        paidProviderCalled: false,
        resendSendFunctionCalled: false,
        productionOutreachQueueChanged: false,
        humanProductionApprovalsChanged: false
      }
    };
  } catch (error) {
    statusCode = 500;
    result = {
      ok: false,
      runId,
      error: error instanceof Error ? error.message : "Unknown website sample self-test failure"
    };
  } finally {
    try {
      if (requestId) await pool.query(`DELETE FROM connect_pilot_interest WHERE id=$1`,[requestId]);
    } catch (cleanupError) {
      statusCode = 500;
      result = {
        ...result,
        ok: false,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : "Synthetic cleanup failed"
      };
    }
  }

  const leftovers = requestId
    ? await pool.query(
      `SELECT
         (SELECT count(*)::int FROM connect_pilot_interest WHERE id=$1) AS sample_requests,
         (SELECT count(*)::int FROM connect_free_sample_matches WHERE request_id=$1) AS sample_matches`,
      [requestId]
    )
    : {rows:[{sample_requests:0,sample_matches:0}]};
  const cleanup = leftovers.rows[0] ?? {sample_requests:0,sample_matches:0};
  const clean = Number(cleanup.sample_requests || 0) === 0 && Number(cleanup.sample_matches || 0) === 0;
  if (!clean) statusCode = 500;

  return NextResponse.json({
    ...result,
    cleanup: {clean,...cleanup}
  }, {status:statusCode});
}
