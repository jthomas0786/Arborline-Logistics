import { createPublicKey, randomUUID, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { classifyPendingConnectReplies, recordConnectInboundReply } from "@/lib/connect-replies";
import { buildFreeSampleEmailDraft } from "@/lib/connect-free-sample-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = "https://token.actions.githubusercontent.com/.well-known/jwks";
const GITHUB_OIDC_AUDIENCE = "arborline-connect-reply-self-test";
const GITHUB_REPOSITORY = "jthomas0786/Arborline-Logistics";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/connect-reply-self-test.yml@refs/heads/main`;

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
      headers: { accept: "application/json", "user-agent": "ArborLine-Reply-Self-Test-OIDC/1.0" },
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
  const companyMarker = `ArborLine Reply Self-Test ${runId}`;
  const testEmail = `reply-self-test-${runId}@example.invalid`;
  let clientId = "";
  let prospectId = "";
  let outreachMessageId = "";
  let replyId = "";
  let sampleRequestId = "";
  let statusCode = 200;
  let result: Record<string, unknown> = {};

  try {
    // Clean up any abandoned synthetic run from an earlier hard timeout. Only rows
    // explicitly marked CONTROLLED_SELF_TEST are eligible for this cleanup.
    await pool.query(
      `DELETE FROM connect_pilot_interest i
       WHERE i.prospect_id IN (
         SELECT p.id FROM connect_prospects p
         WHERE p.source='CONTROLLED_SELF_TEST' AND p.created_at < now() - interval '10 minutes'
       )`
    );
    await pool.query(
      `DELETE FROM connect_clients c
       WHERE c.company_name LIKE 'ArborLine Reply Self-Test %'
         AND c.created_at < now() - interval '10 minutes'`
    );

    const client = await pool.query(
      `INSERT INTO connect_clients
        (company_name,industry,primary_contact_name,primary_contact_email,service_summary,service_area,status)
       VALUES ($1,'Commercial Cleaning','Synthetic Buyer',$2,'Controlled reply/sample regression only.','Chicago, IL','ONBOARDING')
       RETURNING id`,
      [companyMarker, testEmail]
    );
    clientId = String(client.rows[0]?.id || "");
    assert(clientId, "SELF_TEST_CLIENT_CREATE_FAILED");

    const prospect = await pool.query(
      `INSERT INTO connect_prospects
        (client_id,company_name,website,domain,industry,city,state,contact_name,contact_title,contact_email,
         source,source_metadata,enrichment_status,qualification_status,qualification_score,outreach_status,suppression_status)
       VALUES ($1,'Synthetic Commercial Cleaning Co.','https://example.invalid',$2,'Commercial Cleaning','Chicago','IL',
         'Taylor Test','President',$3,'CONTROLLED_SELF_TEST',$4::jsonb,'ENRICHED','QUALIFIED',100,'CONTACTED','CLEAR')
       RETURNING id`,
      [clientId, `self-test-${runId}.example.invalid`, testEmail, JSON.stringify({ controlledSelfTest: true, runId })]
    );
    prospectId = String(prospect.rows[0]?.id || "");
    assert(prospectId, "SELF_TEST_PROSPECT_CREATE_FAILED");

    const originalBody = [
      "Hi Taylor,",
      "",
      "Quick question — want me to send you 3-5 companies that look like they could fit Synthetic Commercial Cleaning Co.?",
      "",
      "No call needed. I can just send the examples over.",
      "",
      "Best,",
      "Josh"
    ].join("\n");

    const outreach = await pool.query(
      `INSERT INTO connect_outreach_messages
        (prospect_id,client_id,sender_email,recipient_email,subject,body_text,status,sent_at,delivered_at,experiment_key,experiment_variant)
       VALUES ($1,$2,'josh@mail.arborlineconnect.com',$3,'quick question about Synthetic Commercial Cleaning Co.',$4,
         'DELIVERED',now(),now(),'alc_reply_self_test','CONTROL')
       RETURNING id`,
      [prospectId, clientId, testEmail, originalBody]
    );
    outreachMessageId = String(outreach.rows[0]?.id || "");
    assert(outreachMessageId, "SELF_TEST_OUTREACH_CREATE_FAILED");

    const recorded = await recordConnectInboundReply({
      providerEmailId: `self-test-${runId}`,
      providerMessageId: `self-test-message-${runId}`,
      fromEmail: testEmail,
      toEmails: ["reply@mail.arborlineconnect.com"],
      subject: "Re: quick question about Synthetic Commercial Cleaning Co.",
      bodyText: "Yes, send them over.",
      rawPayload: { controlledSelfTest: true, runId },
      receivedAt: new Date()
    });
    replyId = String(recorded.id || "");
    assert(recorded.created === true, "SELF_TEST_REPLY_WAS_NOT_CREATED");
    assert(replyId, "SELF_TEST_REPLY_ID_MISSING");
    assert(String(recorded.client_id || "") === clientId, "SELF_TEST_REPLY_CLIENT_MATCH_FAILED");
    assert(String(recorded.prospect_id || "") === prospectId, "SELF_TEST_REPLY_PROSPECT_MATCH_FAILED");
    assert(String(recorded.match_status || "") === "MATCHED", "SELF_TEST_REPLY_MATCH_STATUS_FAILED");

    const classificationRun = await classifyPendingConnectReplies(clientId, 5);
    assert(classificationRun.classified === 1, `SELF_TEST_CLASSIFIED_COUNT_${classificationRun.classified}`);

    const replyState = await pool.query(
      `SELECT classification_status,classification,classification_confidence,classification_reasons
       FROM connect_replies WHERE id=$1 LIMIT 1`,
      [replyId]
    );
    const reply = replyState.rows[0];
    assert(reply?.classification === "SAMPLE_REQUESTED", `SELF_TEST_WRONG_CLASSIFICATION_${reply?.classification || "NULL"}`);
    assert(Number(reply?.classification_confidence) >= 95, "SELF_TEST_CLASSIFICATION_CONFIDENCE_LOW");

    const sampleState = await pool.query(
      `SELECT id,name,work_email,company_name,target_customer,service_area,decision_maker_titles,
              sample_status,sample_provider,sample_generation_error,sample_email_status,
              sample_email_sent_at,sample_email_provider_message_id
       FROM connect_pilot_interest
       WHERE reply_id=$1 AND request_type='FREE_SAMPLE'
       LIMIT 1`,
      [replyId]
    );
    const sample = sampleState.rows[0];
    assert(sample, "SELF_TEST_SAMPLE_REQUEST_NOT_CREATED");
    sampleRequestId = String(sample.id);
    assert(sample.sample_status === "READY", `SELF_TEST_SAMPLE_NOT_READY_${sample.sample_status}:${sample.sample_generation_error || ""}`);
    assert(sample.sample_provider === "OPENSTREETMAP_OVERPASS", `SELF_TEST_UNEXPECTED_PROVIDER_${sample.sample_provider || "NULL"}`);
    assert(sample.sample_email_status === "NOT_DRAFTED", "SELF_TEST_EMAIL_DRAFTED_BEFORE_APPROVAL");
    assert(!sample.sample_email_sent_at && !sample.sample_email_provider_message_id, "SELF_TEST_EMAIL_SENT_BEFORE_APPROVAL");

    const matchesResult = await pool.query(
      `SELECT rank,company_name,industry,city,state,match_score,source,selected
       FROM connect_free_sample_matches
       WHERE request_id=$1
       ORDER BY rank`,
      [sampleRequestId]
    );
    const matches = matchesResult.rows;
    assert(matches.length >= 3 && matches.length <= 5, `SELF_TEST_MATCH_COUNT_${matches.length}`);
    assert(matches.every((row) => row.source === "OPENSTREETMAP_OVERPASS" && row.selected === true), "SELF_TEST_MATCH_SOURCE_OR_SELECTION_FAILED");

    const handoffResult = await pool.query(
      `SELECT count(*)::int AS count FROM connect_handoffs WHERE reply_id=$1`,
      [replyId]
    );
    assert(Number(handoffResult.rows[0]?.count || 0) === 0, "SELF_TEST_SAMPLE_REPLY_CREATED_APPOINTMENT_HANDOFF");

    // Simulate the existing staff 'Approve final matches' step for the synthetic
    // request only. This builds a DRAFT; it intentionally never calls the delivery function.
    const shareToken = randomUUID();
    const draft = buildFreeSampleEmailDraft(sample, matches, shareToken);
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_approved_at=now(),sample_share_token=$2::uuid,
           sample_email_subject=$3,sample_email_body=$4,sample_email_status='DRAFT',
           sample_email_approved_at=NULL,sample_email_sent_at=NULL,sample_email_provider_message_id=NULL,
           sample_email_error=NULL,updated_at=now()
       WHERE id=$1 AND sample_status='READY'`,
      [sampleRequestId, shareToken, draft.subject, draft.body]
    );

    const draftState = await pool.query(
      `SELECT sample_email_status,sample_approved_at,sample_share_token,sample_email_subject,
              sample_email_sent_at,sample_email_provider_message_id
       FROM connect_pilot_interest WHERE id=$1`,
      [sampleRequestId]
    );
    const drafted = draftState.rows[0];
    assert(drafted?.sample_email_status === "DRAFT", "SELF_TEST_APPROVAL_DID_NOT_CREATE_DRAFT");
    assert(drafted?.sample_approved_at && drafted?.sample_share_token && drafted?.sample_email_subject, "SELF_TEST_DRAFT_METADATA_INCOMPLETE");
    assert(!drafted?.sample_email_sent_at && !drafted?.sample_email_provider_message_id, "SELF_TEST_DRAFT_WAS_SENT");

    const prospectState = await pool.query(`SELECT outreach_status FROM connect_prospects WHERE id=$1`, [prospectId]);
    assert(prospectState.rows[0]?.outreach_status === "REPLIED", "SELF_TEST_PROSPECT_NOT_MARKED_REPLIED");

    result = {
      ok: true,
      runId,
      stages: {
        inboundMatched: true,
        prospectMarkedReplied: true,
        classification: reply.classification,
        classificationStatus: reply.classification_status,
        classificationConfidence: reply.classification_confidence,
        sampleStatus: sample.sample_status,
        sampleProvider: sample.sample_provider,
        sampleMatchCount: matches.length,
        appointmentHandoffCreated: false,
        approvalSimulation: "DRAFT_CREATED",
        actualEmailSent: false
      },
      sampleMatches: matches.map((row) => ({
        rank: row.rank,
        companyName: row.company_name,
        industry: row.industry,
        city: row.city,
        state: row.state,
        score: row.match_score
      })),
      safety: {
        syntheticRecipientDomain: "example.invalid",
        paidProviderCalled: false,
        resendSendFunctionCalled: false,
        humanProductionApprovalsChanged: false,
        productionOutreachQueueChanged: false
      }
    };
  } catch (error) {
    statusCode = 500;
    result = {
      ok: false,
      runId,
      error: error instanceof Error ? error.message : "Unknown controlled reply self-test failure"
    };
  } finally {
    // Delete the entire synthetic trail before returning. The sample-match rows
    // cascade from connect_pilot_interest.
    try {
      if (replyId) await pool.query(`DELETE FROM connect_handoffs WHERE reply_id=$1`, [replyId]);
      if (replyId) await pool.query(`DELETE FROM connect_pilot_interest WHERE reply_id=$1`, [replyId]);
      if (prospectId) await pool.query(`DELETE FROM connect_pilot_interest WHERE prospect_id=$1`, [prospectId]);
      if (replyId) await pool.query(`DELETE FROM connect_replies WHERE id=$1`, [replyId]);
      if (outreachMessageId) await pool.query(`DELETE FROM connect_outreach_messages WHERE id=$1`, [outreachMessageId]);
      if (prospectId) await pool.query(`DELETE FROM connect_prospects WHERE id=$1`, [prospectId]);
      if (clientId) await pool.query(`DELETE FROM connect_clients WHERE id=$1`, [clientId]);
    } catch (cleanupError) {
      statusCode = 500;
      result = {
        ...result,
        ok: false,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : "Synthetic cleanup failed"
      };
    }
  }

  const leftovers = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM connect_clients WHERE id=$1) AS clients,
       (SELECT count(*)::int FROM connect_prospects WHERE id=$2) AS prospects,
       (SELECT count(*)::int FROM connect_outreach_messages WHERE id=$3) AS outreach_messages,
       (SELECT count(*)::int FROM connect_replies WHERE id=$4) AS replies,
       (SELECT count(*)::int FROM connect_pilot_interest WHERE id=$5) AS sample_requests`,
    [clientId || null, prospectId || null, outreachMessageId || null, replyId || null, sampleRequestId || null]
  );
  const cleanup = leftovers.rows[0] ?? {};
  const cleanupClean = Object.values(cleanup).every((value) => Number(value || 0) === 0);
  if (!cleanupClean) {
    statusCode = 500;
    result = { ...result, ok: false, cleanupError: "Synthetic records remain after cleanup." };
  }

  return NextResponse.json({ ...result, cleanup: { ...cleanup, clean: cleanupClean } }, {
    status: statusCode,
    headers: { "cache-control": "no-store" }
  });
}
