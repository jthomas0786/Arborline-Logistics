import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { prepareConnectOutreachDrafts } from "@/lib/connect-outreach-drafts";

type MailboxStatus = "VERIFIED" | "INVALID" | "CATCH_ALL" | "TEMPORARY" | "UNKNOWN" | "NETWORK_BLOCKED";
type CatchAllStatus = "UNKNOWN" | "NOT_CATCH_ALL" | "CATCH_ALL" | "TEMPORARY";
type MailboxLane = "fresh" | "retry";

type ClaimedCandidate = {
  id: string;
  client_id: string;
  prospect_id: string;
  segment_id: string | null;
  market_id: string | null;
  email: string;
  contact_name: string | null;
  contact_title: string | null;
  identity_confidence: number;
  email_confidence: number;
  metadata: Record<string, unknown> | null;
  domain: string;
};

type ProbeSubmission = {
  candidateId: string;
  workerId: string;
  claimId?: string | null;
  mxHost?: string | null;
  tlsUsed?: boolean;
  durationMs?: number | null;
  networkError?: string | null;
  targetCode?: number | null;
  targetText?: string | null;
  controlCode?: number | null;
  controlText?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRONG_UNKNOWN_RECIPIENT = /(5\.1\.1|user\s+unknown|unknown\s+user|no\s+such\s+(user|mailbox|recipient)|mailbox[^\r\n]{0,40}(not\s+found|does\s+not\s+exist)|recipient[^\r\n]{0,40}(does\s+not\s+exist|not\s+found|unknown)|invalid\s+recipient|address[^\r\n]{0,40}does\s+not\s+exist)/i;

function normalizeDomain(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function accepted(code: number | null | undefined) {
  return code === 250 || code === 251;
}

function temporary(code: number | null | undefined) {
  return typeof code === "number" && code >= 400 && code < 500;
}

function explicitMissing(code: number | null | undefined, text: string | null | undefined) {
  return typeof code === "number" && code >= 500 && code < 600 && STRONG_UNKNOWN_RECIPIENT.test(String(text ?? ""));
}

function controlProvesInvalidRecipient(code: number | null | undefined, text: string | null | undefined) {
  if (explicitMissing(code, text)) return true;
  // Microsoft Exchange Online Directory-Based Edge Blocking documents this
  // exact 550 5.4.1 response for invalid recipients. Only use it for the
  // randomized control after the real target has already accepted RCPT.
  return code === 550 &&
    /5\.4\.1[^\r\n]{0,160}recipient\s+address\s+rejected:\s*access\s+denied/i.test(String(text ?? ""));
}

function classifyProbe(input: ProbeSubmission): { status: MailboxStatus; catchAll: CatchAllStatus } {
  const networkError = cleanText(input.networkError);
  if (networkError) {
    const blocked = /(EACCES|EPERM|ENETUNREACH|EHOSTUNREACH|NETWORK_BLOCKED|port 25)/i.test(networkError);
    return { status: blocked ? "NETWORK_BLOCKED" : "TEMPORARY", catchAll: "UNKNOWN" };
  }

  if (temporary(input.targetCode)) return { status: "TEMPORARY", catchAll: "UNKNOWN" };
  if (explicitMissing(input.targetCode, input.targetText)) return { status: "INVALID", catchAll: "UNKNOWN" };
  if (!accepted(input.targetCode)) return { status: "UNKNOWN", catchAll: "UNKNOWN" };

  if (accepted(input.controlCode)) return { status: "CATCH_ALL", catchAll: "CATCH_ALL" };
  if (temporary(input.controlCode)) return { status: "TEMPORARY", catchAll: "TEMPORARY" };
  if (controlProvesInvalidRecipient(input.controlCode, input.controlText)) return { status: "VERIFIED", catchAll: "NOT_CATCH_ALL" };
  return { status: "UNKNOWN", catchAll: "UNKNOWN" };
}

function nextProbeDelayMinutes(status: MailboxStatus, failures: number) {
  if (status === "VERIFIED") return 43_200;
  if (status === "CATCH_ALL") return 20_160;
  if (status === "INVALID") return 15;
  if (status === "NETWORK_BLOCKED") {
    if (failures >= 5) return 43_200;
    return Math.min(4_320, 360 * Math.pow(2, Math.max(0, failures - 1)));
  }
  if (status === "TEMPORARY") {
    if (failures >= 6) return 43_200;
    return Math.min(4_320, 60 * Math.pow(2, Math.min(5, failures)));
  }
  if (failures >= 5) return 43_200;
  return Math.min(10_080, 1_440 * Math.pow(2, Math.max(0, failures - 1)));
}

function cacheStatus(status: MailboxStatus) {
  if (status === "VERIFIED") return "VALID";
  if (status === "INVALID") return "INVALID";
  if (status === "CATCH_ALL") return "CATCH_ALL";
  if (["TEMPORARY", "NETWORK_BLOCKED"].includes(status)) return "TEMPORARY";
  return "UNKNOWN";
}

async function learnPattern(client: PoolClient, candidate: ClaimedCandidate) {
  const pattern = String(candidate.metadata?.pattern ?? "").trim();
  if (!pattern) return;
  const { rows } = await client.query(
    `SELECT count(*)::int AS samples
     FROM connect_contact_candidates
     WHERE client_id=$1
       AND lower(split_part(email,'@',2))=lower($2)
       AND email_status='VERIFIED'
       AND metadata->>'pattern'=$3`,
    [candidate.client_id, candidate.domain, pattern]
  );
  const samples = Number(rows[0]?.samples ?? 0);
  if (!samples) return;
  const confidence = samples >= 3 ? 98 : samples === 2 ? 94 : 88;
  await client.query(
    `INSERT INTO connect_domain_email_patterns
       (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
     ON CONFLICT (client_id,domain,pattern) DO UPDATE
     SET verified_samples=GREATEST(connect_domain_email_patterns.verified_samples,excluded.verified_samples),
         confidence=GREATEST(connect_domain_email_patterns.confidence,excluded.confidence),
         metadata=coalesce(connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
         last_observed_at=now()`,
    [candidate.client_id, candidate.domain, pattern, samples, confidence, JSON.stringify({ source: "ARBORLINE_MAILBOX_WORKER", version: 1 })]
  );
}

export async function claimMailboxWorkerCandidate(workerId: string, lane: MailboxLane = "fresh") {
  const safeWorkerId = workerId.trim().slice(0, 160);
  if (!safeWorkerId) throw new Error("Mailbox worker id is required.");
  const safeLane: MailboxLane = lane === "retry" ? "retry" : "fresh";
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<ClaimedCandidate>(
      `SELECT c.id,c.client_id,c.prospect_id,c.segment_id,c.market_id,c.email,c.contact_name,c.contact_title,
              c.identity_confidence,c.email_confidence,c.metadata,
              lower(split_part(c.email,'@',2)) AS domain
       FROM connect_contact_candidates c
       JOIN connect_prospects p ON p.id=c.prospect_id AND p.client_id=c.client_id
       JOIN connect_email_verification_cache v ON v.client_id=c.client_id AND lower(v.email)=lower(c.email)
       LEFT JOIN connect_mailbox_domain_state ds ON ds.client_id=c.client_id AND lower(ds.domain)=lower(split_part(c.email,'@',2))
       LEFT JOIN connect_prospect_segments s ON s.id=coalesce(c.segment_id,p.segment_id)
       LEFT JOIN connect_research_markets m ON m.id=coalesce(c.market_id,p.market_id)
       WHERE c.email IS NOT NULL
         AND (
           ($1='fresh' AND c.email_status='MX_VALID')
           OR
           ($1='retry'
             AND c.email_status IN ('TEMPORARY','UNKNOWN')
             AND c.source_kind IN ('PUBLIC_PROFILE','PUBLIC_SITE')
             AND (
               lower(coalesce(c.metadata->>'direct_published','false'))='true'
               OR lower(coalesce(c.metadata->>'published_email_confirmed','false'))='true'
             )
             AND c.mailbox_retry_exhausted_at IS NULL
             AND (c.mailbox_next_retry_at IS NULL OR c.mailbox_next_retry_at<=now())
             AND c.mailbox_retry_count < CASE
               WHEN coalesce(c.mailbox_last_status,c.email_status) IN ('UNKNOWN','NETWORK_BLOCKED') THEN 5
               ELSE 6
             END
           )
         )
         AND c.identity_confidence>=85
         AND c.email_confidence>=50
         AND v.syntax_valid=true AND v.mx_status='VALID'
         AND p.qualification_status='QUALIFIED' AND p.suppression_status='CLEAR'
         AND p.contact_email IS NULL AND p.contact_name IS NOT NULL
         AND public.connect_contact_name_is_personlike(p.contact_name)
         AND lower(c.contact_name)=lower(p.contact_name)
         AND p.domain IS NOT NULL
         AND lower(split_part(c.email,'@',2))=lower(p.domain)
         AND (p.source<>'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
         AND (ds.id IS NULL OR (ds.next_probe_at<=now() AND (ds.locked_at IS NULL OR ds.locked_at<now()-interval '15 minutes')))
       ORDER BY
                CASE WHEN $1='retry' THEN
                  CASE WHEN c.identity_confidence>=95 THEN 0 WHEN c.identity_confidence>=90 THEN 1 ELSE 2 END
                ELSE 0 END,
                CASE WHEN $1='retry' THEN
                  CASE WHEN (
                    lower(coalesce(c.metadata->>'direct_published','false'))='true'
                    OR lower(coalesce(c.metadata->>'published_email_confirmed','false'))='true'
                  ) THEN 0 ELSE 1 END
                ELSE 0 END,
                CASE WHEN $1='retry' THEN
                  CASE
                    WHEN lower(coalesce(c.contact_title,'')) ~ '(^|[^a-z])(owner|president|chief executive officer|ceo|founder|principal|managing partner)([^a-z]|$)' THEN 0
                    WHEN lower(coalesce(c.contact_title,'')) ~ '(^|[^a-z])(vice president|vp|general manager|managing director|chief [a-z ]+ officer)([^a-z]|$)' THEN 1
                    ELSE 2
                  END
                ELSE 0 END,
                CASE WHEN $1='retry' AND s.slug='commercial-cleaning' AND m.slug='chicago' THEN 0
                     WHEN $1='retry' THEN 1 ELSE 0 END,
                CASE WHEN $1='retry' THEN coalesce(m.priority,0) ELSE 0 END DESC,
                CASE WHEN EXISTS (
                  SELECT 1 FROM connect_prepared_outreach_drafts pd
                  WHERE pd.prospect_id=p.id AND pd.status='PREPARED'
                ) THEN 0 ELSE 1 END,
                CASE c.source_kind WHEN 'PUBLIC_PROFILE' THEN 0 WHEN 'PUBLIC_SITE' THEN 1 WHEN 'LEARNED_PATTERN' THEN 2 ELSE 3 END,
                c.email_confidence DESC,c.identity_confidence DESC,c.last_seen_at ASC
       FOR UPDATE OF c SKIP LOCKED
       LIMIT 12`,
      [safeLane]
    );

    for (const raw of rows) {
      const domain = normalizeDomain(raw.domain);
      if (!domain) continue;
      await client.query(
        `INSERT INTO connect_mailbox_domain_state(client_id,domain) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [raw.client_id, domain]
      );
      const claimId = randomUUID();
      const claimed = await client.query(
        `UPDATE connect_mailbox_domain_state
         SET locked_at=now(),locked_by=$3,active_claim_id=$4,updated_at=now()
         WHERE client_id=$1 AND lower(domain)=lower($2)
           AND next_probe_at<=now()
           AND (locked_at IS NULL OR locked_at<now()-interval '15 minutes')
         RETURNING id`,
        [raw.client_id, domain, safeWorkerId, claimId]
      );
      if (!claimed.rows[0]) continue;
      await client.query("COMMIT");
      return {
        candidateId: raw.id,
        email: raw.email,
        domain,
        lane: safeLane,
        workerId: safeWorkerId,
        claimId,
        claimedAt: new Date().toISOString()
      };
    }

    await client.query("COMMIT");
    return null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeMailboxWorkerCandidate(input: ProbeSubmission) {
  const workerId = input.workerId.trim().slice(0, 160);
  if (!workerId) throw new Error("Mailbox worker id is required.");
  const rawClaimId = String(input.claimId ?? "").trim();
  if (rawClaimId && !UUID_PATTERN.test(rawClaimId)) throw new Error("Mailbox claim id is invalid.");
  const claimId = rawClaimId || null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (claimId) {
      const prior = await client.query<{
        candidate_id: string | null;
        prospect_id: string | null;
        domain: string;
        status: MailboxStatus;
        catch_all_result: CatchAllStatus;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT candidate_id,prospect_id,domain,status,catch_all_result,metadata
         FROM connect_mailbox_verification_attempts
         WHERE claim_id=$1 AND candidate_id=$2
         LIMIT 1`,
        [claimId,input.candidateId]
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        const metadata = row.metadata ?? {};
        await client.query("COMMIT");
        return {
          candidateId:row.candidate_id ?? input.candidateId,
          prospectId:row.prospect_id,
          domain:row.domain,
          status:row.status,
          catchAll:row.catch_all_result,
          promoted:metadata.promoted === true,
          draftsCreated:Number(metadata.drafts_created ?? 0) || 0,
          draftPreparationError:typeof metadata.draft_preparation_error === "string" ? metadata.draft_preparation_error : null,
          approvalsCreated:0,
          messagesSent:0,
          alreadyFinalized:true
        };
      }
    }

    const found = await client.query<ClaimedCandidate & {
      consecutive_failures: number;
      mailbox_retry_count: number;
      mailbox_last_status: string | null;
      mailbox_next_retry_at: Date | null;
      mailbox_retry_exhausted_at: Date | null;
    }>(
      `SELECT c.id,c.client_id,c.prospect_id,c.segment_id,c.market_id,c.email,c.contact_name,c.contact_title,
              c.identity_confidence,c.email_confidence,c.metadata,
              lower(split_part(c.email,'@',2)) AS domain,
              ds.consecutive_failures,c.mailbox_retry_count,c.mailbox_last_status,c.mailbox_next_retry_at,c.mailbox_retry_exhausted_at
       FROM connect_contact_candidates c
       JOIN connect_prospects p ON p.id=c.prospect_id AND p.client_id=c.client_id
       JOIN connect_mailbox_domain_state ds ON ds.client_id=c.client_id AND lower(ds.domain)=lower(split_part(c.email,'@',2))
       WHERE c.id=$1 AND ds.locked_by=$2 AND ds.locked_at>now()-interval '20 minutes'
         AND ($3::uuid IS NULL OR ds.active_claim_id=$3::uuid)
         AND p.contact_name IS NOT NULL
         AND public.connect_contact_name_is_personlike(p.contact_name)
         AND lower(c.contact_name)=lower(p.contact_name)
       FOR UPDATE OF c,ds`,
      [input.candidateId, workerId, claimId]
    );
    const candidate = found.rows[0];
    if (!candidate) throw new Error("Mailbox candidate is not claimed by this worker, the claim expired, or the claim id is stale.");

    const classification = classifyProbe(input);
    const status = classification.status;
    const catchAll = classification.catchAll;
    const response = status === "VERIFIED" ? cleanText(input.targetText) : cleanText(input.networkError || input.controlText || input.targetText);
    const smtpCode = status === "VERIFIED" || status === "CATCH_ALL" ? (input.targetCode ?? null) : (input.targetCode ?? input.controlCode ?? null);
    const failure = ["TEMPORARY", "UNKNOWN", "NETWORK_BLOCKED"].includes(status);
    const failures = failure ? Number(candidate.consecutive_failures ?? 0) + 1 : 0;
    const delayMinutes = nextProbeDelayMinutes(status, failures);
    const priorCandidateRetryCount = Math.max(0, Number(candidate.mailbox_retry_count ?? 0) || 0);
    const candidateRetryCount = failure ? priorCandidateRetryCount + 1 : priorCandidateRetryCount;
    const candidateRetryLimit = ["UNKNOWN", "NETWORK_BLOCKED"].includes(status) ? 5 : 6;
    const candidateRetryExhausted = failure && candidateRetryCount >= candidateRetryLimit;
    const candidateRetryDelayMinutes = failure ? nextProbeDelayMinutes(status, candidateRetryCount) : 0;
    const durationMs = Math.max(0, Math.min(300_000, Number(input.durationMs ?? 0) || 0));

    const insertedAttempt = await client.query<{ id: string }>(
      `INSERT INTO connect_mailbox_verification_attempts
         (client_id,candidate_id,prospect_id,claim_id,email,domain,mx_host,status,smtp_code,response_excerpt,catch_all_result,tls_used,duration_ms,metadata,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
       ON CONFLICT (claim_id) WHERE claim_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [candidate.client_id,candidate.id,candidate.prospect_id,claimId,candidate.email,candidate.domain,input.mxHost ?? null,status,smtpCode,response,catchAll,Boolean(input.tlsUsed),durationMs,JSON.stringify({
        worker: "GITHUB_OIDC_MAILBOX_WORKER",
        target_code: input.targetCode ?? null,
        control_code: input.controlCode ?? null,
        verifier_version: 2,
        claim_id: claimId
      })]
    );
    if (!insertedAttempt.rows[0]) {
      await client.query("ROLLBACK");
      const prior = claimId ? await pool.query<{
        candidate_id: string | null;
        prospect_id: string | null;
        domain: string;
        status: MailboxStatus;
        catch_all_result: CatchAllStatus;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT candidate_id,prospect_id,domain,status,catch_all_result,metadata
         FROM connect_mailbox_verification_attempts WHERE claim_id=$1 LIMIT 1`,
        [claimId]
      ) : null;
      const row = prior?.rows[0];
      if (!row) throw new Error("Mailbox result claim was already finalized.");
      const metadata = row.metadata ?? {};
      return {
        candidateId:row.candidate_id ?? input.candidateId,
        prospectId:row.prospect_id,
        domain:row.domain,
        status:row.status,
        catchAll:row.catch_all_result,
        promoted:metadata.promoted === true,
        draftsCreated:Number(metadata.drafts_created ?? 0) || 0,
        draftPreparationError:typeof metadata.draft_preparation_error === "string" ? metadata.draft_preparation_error : null,
        approvalsCreated:0,
        messagesSent:0,
        alreadyFinalized:true
      };
    }

    const candidateStatus = status === "NETWORK_BLOCKED" ? "TEMPORARY" : status;
    await client.query(
      `UPDATE connect_contact_candidates
       SET email_status=$2,
           email_confidence=CASE WHEN $2='VERIFIED' THEN GREATEST(email_confidence,98) ELSE email_confidence END,
           verified_at=CASE WHEN $2='VERIFIED' THEN now() ELSE verified_at END,
           evidence=coalesce(evidence,'[]'::jsonb)||$3::jsonb,
           metadata=coalesce(metadata,'{}'::jsonb)||$4::jsonb,
           last_seen_at=now()
       WHERE id=$1`,
      [candidate.id,candidateStatus,JSON.stringify([
        status === "VERIFIED"
          ? "ArborLine mailbox worker observed the target mailbox accepted while a randomized same-domain address was explicitly rejected as nonexistent."
          : `ArborLine mailbox worker result: ${status}.`
      ]),JSON.stringify({ mailbox_verification: {
        status,catch_all:catchAll,verified_at:status === "VERIFIED" ? new Date().toISOString() : null,
        mx_host:input.mxHost ?? null,smtp_code:smtpCode,tls_used:Boolean(input.tlsUsed),verifier_version:2,claim_id:claimId
      }})]
    );

    await client.query(
      `UPDATE connect_contact_candidates
       SET mailbox_retry_count=$2,
           mailbox_last_status=$3,
           mailbox_next_retry_at=CASE
             WHEN $4 THEN NULL
             WHEN $5 THEN now()+($6*interval '1 minute')
             ELSE NULL
           END,
           mailbox_retry_exhausted_at=CASE
             WHEN $4 THEN coalesce(mailbox_retry_exhausted_at,now())
             ELSE NULL
           END
       WHERE id=$1`,
      [candidate.id,candidateRetryCount,status,candidateRetryExhausted,failure,candidateRetryDelayMinutes]
    );

    await client.query(
      `INSERT INTO connect_email_verification_cache
         (client_id,email,domain,syntax_valid,mx_status,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
       VALUES ($1,$2,$3,true,'VALID',$4,false,$5,$6::jsonb,now(),now()+interval '30 days')
       ON CONFLICT (client_id,email) DO UPDATE
       SET smtp_status=excluded.smtp_status,
           confidence=CASE WHEN connect_email_verification_cache.provider_verified THEN connect_email_verification_cache.confidence ELSE excluded.confidence END,
           evidence=coalesce(connect_email_verification_cache.evidence,'{}'::jsonb)||excluded.evidence,
           checked_at=now(),
           expires_at=CASE
             WHEN excluded.smtp_status='VALID' THEN now()+interval '180 days'
             WHEN excluded.smtp_status IN ('INVALID','CATCH_ALL') THEN now()+interval '30 days'
             ELSE now()+interval '1 day'
           END`,
      [candidate.client_id,candidate.email,candidate.domain,cacheStatus(status),status === "VERIFIED" ? 98 : candidate.email_confidence,JSON.stringify({
        arborline_mailbox_worker: { status,catch_all:catchAll,mx_host:input.mxHost ?? null,smtp_code:smtpCode,tls_used:Boolean(input.tlsUsed),checked_at:new Date().toISOString(),version:2,claim_id:claimId }
      })]
    );

    let promoted = false;
    if (status === "VERIFIED") {
      const promotedResult = await client.query(
        `UPDATE connect_prospects
         SET contact_email=$2,enrichment_status='ENRICHED',outreach_status='READY',
             source_metadata=coalesce(source_metadata,'{}'::jsonb)||$3::jsonb,updated_at=now()
         WHERE id=$1 AND contact_email IS NULL AND qualification_status='QUALIFIED' AND suppression_status='CLEAR'
           AND contact_name IS NOT NULL AND public.connect_contact_name_is_personlike(contact_name)
           AND lower(domain)=lower($4)
           AND (source<>'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
           AND NOT EXISTS (
             SELECT 1 FROM connect_suppressions s
             WHERE (s.client_id IS NULL OR s.client_id=connect_prospects.client_id)
               AND ((s.email IS NOT NULL AND lower(s.email)=lower($2)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower(connect_prospects.domain)))
           )
         RETURNING id`,
        [candidate.prospect_id,candidate.email,JSON.stringify({
          contact_enrichment_provider:"ARBORLINE_NATIVE",email_status:"VERIFIED",
          native_mailbox_verification:{email:candidate.email,status:"VERIFIED",catch_all:false,verified_at:new Date().toISOString(),method:"SMTP_RCPT_WITH_CATCH_ALL_CONTROL",verifier_version:2,claim_id:claimId},
          native_contact_enrichment:{checked_at:new Date().toISOString(),engine_version:1,best_candidate_email:candidate.email,best_candidate_status:"VERIFIED",best_candidate_confidence:98,mailbox_verified:true,provider_fallback_recommended:false}
        }),candidate.domain]
      );
      promoted = Boolean(promotedResult.rows[0]);
      await learnPattern(client, candidate);
    }

    if (claimId) {
      await client.query(
        `UPDATE connect_mailbox_verification_attempts
         SET metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb
         WHERE claim_id=$1`,
        [claimId,JSON.stringify({ promoted })]
      );
    }

    await client.query(
      `UPDATE connect_mailbox_domain_state
       SET last_status=$3,catch_all_status=$4,consecutive_failures=$5,last_probe_at=now(),
           last_success_at=CASE WHEN $3='VERIFIED' THEN now() ELSE last_success_at END,
           next_probe_at=now()+($6*interval '1 minute'),locked_at=NULL,locked_by=NULL,active_claim_id=NULL,
           metadata=coalesce(metadata,'{}'::jsonb)||$7::jsonb,updated_at=now()
       WHERE client_id=$1 AND lower(domain)=lower($2)
         AND ($8::uuid IS NULL OR active_claim_id=$8::uuid)`,
      [candidate.client_id,candidate.domain,status,catchAll,failures,delayMinutes,JSON.stringify({
        last_mx_host:input.mxHost ?? null,last_smtp_code:smtpCode,tls_used:Boolean(input.tlsUsed),worker:"GITHUB_OIDC_MAILBOX_WORKER",verifier_version:2,last_claim_id:claimId
      }),claimId]
    );

    await client.query("COMMIT");

    let draftsCreated = 0;
    let draftPreparationError: string | null = null;
    if (promoted && candidate.segment_id) {
      try {
        const drafts = await prepareConnectOutreachDrafts(candidate.client_id, 10, candidate.segment_id);
        draftsCreated = drafts.draftsCreated;
      } catch (error) {
        draftPreparationError = error instanceof Error ? error.message.slice(0, 500) : "Unknown draft preparation error";
      }
    }

    if (claimId) {
      await client.query(
        `UPDATE connect_mailbox_verification_attempts
         SET metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb
         WHERE claim_id=$1`,
        [claimId,JSON.stringify({ drafts_created:draftsCreated,draft_preparation_error:draftPreparationError })]
      ).catch(() => undefined);
    }

    return {
      candidateId:candidate.id,
      prospectId:candidate.prospect_id,
      domain:candidate.domain,
      status,
      catchAll,
      promoted,
      mailboxRetryCount:candidateRetryCount,
      mailboxRetryLimit:candidateRetryLimit,
      mailboxRetryExhausted:candidateRetryExhausted,
      draftsCreated,
      draftPreparationError,
      approvalsCreated:0,
      messagesSent:0,
      alreadyFinalized:false
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}