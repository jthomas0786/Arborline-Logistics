import { randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { connect as netConnect, Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { getPool } from "@/lib/db";

type MailboxStatus = "VERIFIED" | "INVALID" | "CATCH_ALL" | "TEMPORARY" | "UNKNOWN" | "NETWORK_BLOCKED" | "DEFERRED";
type CatchAllStatus = "UNKNOWN" | "NOT_CATCH_ALL" | "CATCH_ALL" | "TEMPORARY";
type SmtpSocket = Socket | TLSSocket;

type CandidateRow = {
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
  prospect_source_metadata: Record<string, unknown> | null;
};

type SmtpResponse = {
  code: number;
  text: string;
};

type ProbeResult = {
  status: MailboxStatus;
  catchAll: CatchAllStatus;
  smtpCode: number | null;
  responseExcerpt: string;
  mxHost: string | null;
  tlsUsed: boolean;
  metadata: Record<string, unknown>;
};

const SMTP_TIMEOUT_MS = 9_000;
const MAX_MX_HOSTS = 2;
const VERIFY_HELO = "mail.arborlineconnect.com";
const DEFAULT_MAIL_FROM = "josh@mail.arborlineconnect.com";
const STRONG_UNKNOWN_RECIPIENT = /(5\.1\.1|user\s+unknown|unknown\s+user|no\s+such\s+(user|mailbox|recipient)|mailbox[^\r\n]{0,40}(not\s+found|does\s+not\s+exist)|recipient[^\r\n]{0,40}(does\s+not\s+exist|not\s+found|unknown)|invalid\s+recipient|address[^\r\n]{0,40}does\s+not\s+exist)/i;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function normalizeDomain(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

function responseExcerpt(value: string) {
  return value.replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function accepted(response: SmtpResponse) {
  return response.code === 250 || response.code === 251;
}

function temporary(response: SmtpResponse) {
  return response.code >= 400 && response.code < 500;
}

function strongRecipientMissing(response: SmtpResponse) {
  return response.code >= 500 && response.code < 600 && STRONG_UNKNOWN_RECIPIENT.test(response.text);
}

function networkBlockedCode(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "").toUpperCase();
  return ["EACCES", "EPERM", "ENETUNREACH", "EHOSTUNREACH", "ERR_NETWORK_ACCESS_DENIED"].includes(code);
}

function errorSummary(error: unknown) {
  if (error instanceof Error) {
    const code = String((error as Error & { code?: unknown }).code ?? "").trim();
    return `${code ? `${code}: ` : ""}${error.message}`.slice(0, 500);
  }
  return String(error ?? "Unknown SMTP error").slice(0, 500);
}

async function readResponse(socket: SmtpSocket, timeoutMs = SMTP_TIMEOUT_MS): Promise<SmtpResponse> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => finishError(new Error("SMTP_RESPONSE_TIMEOUT")), timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", finishError);
      socket.off("close", onClose);
    };
    const finishError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => finishError(new Error("SMTP_CONNECTION_CLOSED"));
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\d{3})([ -])/);
        if (!match || match[2] !== " ") continue;
        cleanup();
        resolve({ code: Number(match[1]), text: buffer.trim() });
        return;
      }
    };

    socket.on("data", onData);
    socket.once("error", finishError);
    socket.once("close", onClose);
  });
}

async function command(socket: SmtpSocket, value: string) {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${value}\r\n`, (error) => error ? reject(error) : resolve());
  });
  return readResponse(socket);
}

async function openSmtp(host: string) {
  const socket = netConnect({ host, port: 25 });
  socket.setKeepAlive(false);
  socket.setNoDelay(true);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP_CONNECT_TIMEOUT"));
    }, SMTP_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
  const banner = await readResponse(socket);
  if (banner.code < 200 || banner.code >= 400) {
    socket.destroy();
    throw new Error(`SMTP_BANNER_${banner.code}: ${responseExcerpt(banner.text)}`);
  }
  return { socket, banner };
}

async function maybeStartTls(socket: Socket, host: string, ehlo: SmtpResponse) {
  if (!/\bSTARTTLS\b/i.test(ehlo.text)) return { socket: socket as SmtpSocket, tlsUsed: false, ehlo };
  const start = await command(socket, "STARTTLS");
  if (start.code !== 220) return { socket: socket as SmtpSocket, tlsUsed: false, ehlo };

  const tlsSocket = tlsConnect({ socket, servername: host, rejectUnauthorized: true });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error("SMTP_TLS_TIMEOUT"));
    }, SMTP_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      tlsSocket.off("secureConnect", onSecure);
      tlsSocket.off("error", onError);
    };
    const onSecure = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    tlsSocket.once("secureConnect", onSecure);
    tlsSocket.once("error", onError);
  });
  const postTlsEhlo = await command(tlsSocket, `EHLO ${VERIFY_HELO}`);
  return { socket: tlsSocket as SmtpSocket, tlsUsed: true, ehlo: postTlsEhlo };
}

async function resolveMxHosts(domain: string) {
  const records = await Promise.race([
    resolveMx(domain),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MX_TIMEOUT")), 4_000))
  ]);
  return records
    .filter((record) => Boolean(record.exchange))
    .sort((a, b) => a.priority - b.priority)
    .map((record) => record.exchange.toLowerCase())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_MX_HOSTS);
}

async function probeMxHost(host: string, targetEmail: string, domain: string): Promise<ProbeResult> {
  let activeSocket: SmtpSocket | null = null;
  let tlsUsed = false;
  try {
    const opened = await openSmtp(host);
    activeSocket = opened.socket;
    let ehlo = await command(activeSocket, `EHLO ${VERIFY_HELO}`);
    if (ehlo.code >= 400) ehlo = await command(activeSocket, `HELO ${VERIFY_HELO}`);
    if (ehlo.code >= 400) {
      return {
        status: temporary(ehlo) ? "TEMPORARY" : "UNKNOWN",
        catchAll: "UNKNOWN",
        smtpCode: ehlo.code,
        responseExcerpt: responseExcerpt(ehlo.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "EHLO" }
      };
    }

    if (/\bSTARTTLS\b/i.test(ehlo.text) && activeSocket instanceof Socket) {
      const upgraded = await maybeStartTls(activeSocket, host, ehlo);
      activeSocket = upgraded.socket;
      tlsUsed = upgraded.tlsUsed;
      ehlo = upgraded.ehlo;
      if (ehlo.code >= 400) {
        return {
          status: temporary(ehlo) ? "TEMPORARY" : "UNKNOWN",
          catchAll: "UNKNOWN",
          smtpCode: ehlo.code,
          responseExcerpt: responseExcerpt(ehlo.text),
          mxHost: host,
          tlsUsed,
          metadata: { stage: "EHLO_AFTER_TLS" }
        };
      }
    }

    const sender = (process.env.CONNECT_MAILBOX_VERIFY_MAIL_FROM?.trim() || DEFAULT_MAIL_FROM).toLowerCase();
    const mailFrom = await command(activeSocket, `MAIL FROM:<${sender}>`);
    if (!accepted(mailFrom)) {
      return {
        status: temporary(mailFrom) ? "TEMPORARY" : "UNKNOWN",
        catchAll: "UNKNOWN",
        smtpCode: mailFrom.code,
        responseExcerpt: responseExcerpt(mailFrom.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "MAIL_FROM" }
      };
    }

    const target = await command(activeSocket, `RCPT TO:<${targetEmail}>`);
    if (!accepted(target)) {
      const status: MailboxStatus = strongRecipientMissing(target)
        ? "INVALID"
        : temporary(target)
          ? "TEMPORARY"
          : "UNKNOWN";
      return {
        status,
        catchAll: "UNKNOWN",
        smtpCode: target.code,
        responseExcerpt: responseExcerpt(target.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "TARGET_RCPT", target_accepted: false }
      };
    }

    await command(activeSocket, "RSET").catch(() => null);
    const catchAllMailFrom = await command(activeSocket, `MAIL FROM:<${sender}>`);
    if (!accepted(catchAllMailFrom)) {
      return {
        status: temporary(catchAllMailFrom) ? "TEMPORARY" : "UNKNOWN",
        catchAll: "UNKNOWN",
        smtpCode: catchAllMailFrom.code,
        responseExcerpt: responseExcerpt(catchAllMailFrom.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "CATCH_ALL_MAIL_FROM", target_accepted: true }
      };
    }

    const impossible = `arborline-verify-${randomBytes(12).toString("hex")}@${domain}`;
    const catchAll = await command(activeSocket, `RCPT TO:<${impossible}>`);
    if (accepted(catchAll)) {
      return {
        status: "CATCH_ALL",
        catchAll: "CATCH_ALL",
        smtpCode: target.code,
        responseExcerpt: responseExcerpt(catchAll.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "CATCH_ALL_RCPT", target_accepted: true, randomized_recipient_accepted: true }
      };
    }
    if (strongRecipientMissing(catchAll)) {
      return {
        status: "VERIFIED",
        catchAll: "NOT_CATCH_ALL",
        smtpCode: target.code,
        responseExcerpt: responseExcerpt(target.text),
        mxHost: host,
        tlsUsed,
        metadata: { stage: "CATCH_ALL_RCPT", target_accepted: true, randomized_recipient_rejected: true, random_reject_code: catchAll.code }
      };
    }
    return {
      status: temporary(catchAll) ? "TEMPORARY" : "UNKNOWN",
      catchAll: temporary(catchAll) ? "TEMPORARY" : "UNKNOWN",
      smtpCode: catchAll.code,
      responseExcerpt: responseExcerpt(catchAll.text),
      mxHost: host,
      tlsUsed,
      metadata: { stage: "CATCH_ALL_RCPT", target_accepted: true, randomized_recipient_inconclusive: true }
    };
  } finally {
    if (activeSocket && !activeSocket.destroyed) {
      try { activeSocket.write("QUIT\r\n"); } catch { /* ignore */ }
      activeSocket.destroy();
    }
  }
}

async function probeMailbox(email: string, domain: string): Promise<ProbeResult> {
  let hosts: string[] = [];
  try {
    hosts = await resolveMxHosts(domain);
  } catch (error) {
    return {
      status: "TEMPORARY",
      catchAll: "UNKNOWN",
      smtpCode: null,
      responseExcerpt: errorSummary(error),
      mxHost: null,
      tlsUsed: false,
      metadata: { stage: "MX_LOOKUP", error: errorSummary(error) }
    };
  }
  if (!hosts.length) {
    return {
      status: "UNKNOWN",
      catchAll: "UNKNOWN",
      smtpCode: null,
      responseExcerpt: "No MX host was available during mailbox verification.",
      mxHost: null,
      tlsUsed: false,
      metadata: { stage: "MX_LOOKUP", mx_hosts: [] }
    };
  }

  const failures: Array<Record<string, unknown>> = [];
  for (const host of hosts) {
    try {
      const result = await probeMxHost(host, email, domain);
      if (["VERIFIED", "INVALID", "CATCH_ALL"].includes(result.status)) {
        result.metadata = { ...result.metadata, attempted_hosts: failures.length + 1, mx_hosts: hosts };
        return result;
      }
      failures.push({ host, status: result.status, response: result.responseExcerpt, smtp_code: result.smtpCode });
      if (result.status === "TEMPORARY") continue;
      return { ...result, metadata: { ...result.metadata, attempted_hosts: failures.length, mx_hosts: hosts, failures } };
    } catch (error) {
      failures.push({ host, error: errorSummary(error) });
      if (networkBlockedCode(error)) {
        return {
          status: "NETWORK_BLOCKED",
          catchAll: "UNKNOWN",
          smtpCode: null,
          responseExcerpt: errorSummary(error),
          mxHost: host,
          tlsUsed: false,
          metadata: { stage: "CONNECT", mx_hosts: hosts, failures }
        };
      }
    }
  }
  return {
    status: failures.some((item) => String(item.error ?? "").includes("TIMEOUT")) ? "TEMPORARY" : "UNKNOWN",
    catchAll: "UNKNOWN",
    smtpCode: null,
    responseExcerpt: responseExcerpt(JSON.stringify(failures)),
    mxHost: hosts[0] ?? null,
    tlsUsed: false,
    metadata: { stage: "CONNECT", mx_hosts: hosts, failures }
  };
}

async function claimDomain(clientId: string, domain: string, workerId: string) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO connect_mailbox_domain_state(client_id,domain)
     VALUES($1,$2)
     ON CONFLICT DO NOTHING`,
    [clientId, domain]
  );
  const { rows } = await pool.query(
    `UPDATE connect_mailbox_domain_state
     SET locked_at=now(),locked_by=$3,updated_at=now()
     WHERE client_id=$1 AND lower(domain)=lower($2)
       AND next_probe_at<=now()
       AND (locked_at IS NULL OR locked_at<now()-interval '15 minutes')
     RETURNING *`,
    [clientId, domain, workerId]
  );
  return rows[0] ?? null;
}

function nextProbeDelayMinutes(status: MailboxStatus, failures: number) {
  if (status === "VERIFIED") return 43_200;
  if (status === "CATCH_ALL") return 20_160;
  if (status === "INVALID") return 60;
  if (status === "NETWORK_BLOCKED") return 360;
  if (status === "TEMPORARY") return Math.min(4_320, 60 * Math.pow(2, Math.min(5, failures)));
  return 1_440;
}

async function releaseDomain(clientId: string, domain: string, result: ProbeResult, priorFailures: number) {
  const failure = ["TEMPORARY", "UNKNOWN", "NETWORK_BLOCKED"].includes(result.status);
  const failures = failure ? priorFailures + 1 : 0;
  const delayMinutes = nextProbeDelayMinutes(result.status, failures);
  await getPool().query(
    `UPDATE connect_mailbox_domain_state
     SET last_status=$3,
         catch_all_status=$4,
         consecutive_failures=$5,
         last_probe_at=now(),
         last_success_at=CASE WHEN $3='VERIFIED' THEN now() ELSE last_success_at END,
         next_probe_at=now()+($6*interval '1 minute'),
         locked_at=NULL,locked_by=NULL,
         metadata=coalesce(metadata,'{}'::jsonb)||$7::jsonb,
         updated_at=now()
     WHERE client_id=$1 AND lower(domain)=lower($2)`,
    [clientId, domain, result.status, result.catchAll, failures, delayMinutes, JSON.stringify({
      last_mx_host: result.mxHost,
      last_smtp_code: result.smtpCode,
      tls_used: result.tlsUsed,
      verifier_version: 1
    })]
  );
}

async function recordAttempt(input: {
  candidate: CandidateRow;
  workerJobId?: string | null;
  result: ProbeResult;
  startedAt: number;
}) {
  await getPool().query(
    `INSERT INTO connect_mailbox_verification_attempts
       (client_id,candidate_id,prospect_id,worker_job_id,email,domain,mx_host,status,smtp_code,response_excerpt,
        catch_all_result,tls_used,duration_ms,metadata,started_at,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,to_timestamp($15/1000.0),now())`,
    [
      input.candidate.client_id,
      input.candidate.id,
      input.candidate.prospect_id,
      input.workerJobId ?? null,
      input.candidate.email,
      input.candidate.domain,
      input.result.mxHost,
      input.result.status,
      input.result.smtpCode,
      input.result.responseExcerpt,
      input.result.catchAll,
      input.result.tlsUsed,
      Math.max(0, Date.now() - input.startedAt),
      JSON.stringify(input.result.metadata),
      input.startedAt
    ]
  );
}

function cacheSmtpStatus(status: MailboxStatus) {
  if (status === "VERIFIED") return "VALID";
  if (status === "INVALID") return "INVALID";
  if (status === "CATCH_ALL") return "CATCH_ALL";
  if (["TEMPORARY", "NETWORK_BLOCKED", "DEFERRED"].includes(status)) return "TEMPORARY";
  return "UNKNOWN";
}

async function updateVerificationEvidence(candidate: CandidateRow, result: ProbeResult) {
  const pool = getPool();
  const candidateStatus = result.status === "NETWORK_BLOCKED" ? "TEMPORARY" : result.status;
  const verified = result.status === "VERIFIED";
  const confidence = verified ? 98 : candidate.email_confidence;
  await pool.query(
    `UPDATE connect_contact_candidates
     SET email_status=$2,
         email_confidence=CASE WHEN $2='VERIFIED' THEN GREATEST(email_confidence,98) ELSE email_confidence END,
         verified_at=CASE WHEN $2='VERIFIED' THEN now() ELSE verified_at END,
         evidence=coalesce(evidence,'[]'::jsonb)||$3::jsonb,
         metadata=coalesce(metadata,'{}'::jsonb)||$4::jsonb,
         last_seen_at=now()
     WHERE id=$1`,
    [candidate.id, candidateStatus, JSON.stringify([
      verified
        ? "ArborLine mailbox verifier observed the target mailbox accepted while a randomized same-domain address was explicitly rejected as nonexistent."
        : `ArborLine mailbox verifier result: ${result.status}.`
    ]), JSON.stringify({
      mailbox_verification: {
        status: result.status,
        catch_all: result.catchAll,
        verified_at: verified ? new Date().toISOString() : null,
        mx_host: result.mxHost,
        smtp_code: result.smtpCode,
        tls_used: result.tlsUsed,
        verifier_version: 1
      }
    })]
  );

  await pool.query(
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
    [candidate.client_id, candidate.email, candidate.domain, cacheSmtpStatus(result.status), confidence, JSON.stringify({
      arborline_mailbox_verifier: {
        status: result.status,
        catch_all: result.catchAll,
        mx_host: result.mxHost,
        smtp_code: result.smtpCode,
        tls_used: result.tlsUsed,
        checked_at: new Date().toISOString(),
        version: 1
      }
    })]
  );
}

async function learnVerifiedPattern(candidate: CandidateRow) {
  const pattern = String(candidate.metadata?.pattern ?? "").trim();
  if (!pattern) return;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS samples
     FROM connect_contact_candidates c
     WHERE c.client_id=$1
       AND lower(split_part(c.email,'@',2))=lower($2)
       AND c.email_status='VERIFIED'
       AND c.metadata->>'pattern'=$3`,
    [candidate.client_id, candidate.domain, pattern]
  );
  const samples = Number(rows[0]?.samples ?? 0);
  if (!samples) return;
  const confidence = samples >= 3 ? 98 : samples === 2 ? 94 : 88;
  await pool.query(
    `INSERT INTO connect_domain_email_patterns
       (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
     ON CONFLICT (client_id,domain,pattern) DO UPDATE
     SET verified_samples=GREATEST(connect_domain_email_patterns.verified_samples,excluded.verified_samples),
         confidence=GREATEST(connect_domain_email_patterns.confidence,excluded.confidence),
         metadata=coalesce(connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
         last_observed_at=now()`,
    [candidate.client_id, candidate.domain, pattern, samples, confidence, JSON.stringify({ source: "ARBORLINE_MAILBOX_VERIFIER", version: 1 })]
  );
}

async function promoteVerifiedCandidate(candidate: CandidateRow) {
  const pool = getPool();
  const verifiedAt = new Date().toISOString();
  const result = await pool.query(
    `UPDATE connect_prospects
     SET contact_email=$2,
         enrichment_status='ENRICHED',
         outreach_status='READY',
         source_metadata=coalesce(source_metadata,'{}'::jsonb)||$3::jsonb,
         updated_at=now()
     WHERE id=$1
       AND contact_email IS NULL
       AND qualification_status='QUALIFIED'
       AND suppression_status='CLEAR'
       AND contact_name IS NOT NULL
       AND lower(domain)=lower($4)
       AND (source<>'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=connect_prospects.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower($2))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(connect_prospects.domain)))
       )
     RETURNING id`,
    [candidate.prospect_id, candidate.email, JSON.stringify({
      contact_enrichment_provider: "ARBORLINE_NATIVE",
      email_status: "VERIFIED",
      native_mailbox_verification: {
        email: candidate.email,
        status: "VERIFIED",
        catch_all: false,
        verified_at: verifiedAt,
        method: "SMTP_RCPT_WITH_CATCH_ALL_CONTROL",
        verifier_version: 1
      },
      native_contact_enrichment: {
        checked_at: verifiedAt,
        engine_version: 1,
        best_candidate_email: candidate.email,
        best_candidate_status: "VERIFIED",
        best_candidate_confidence: 98,
        mailbox_verified: true,
        provider_fallback_recommended: false
      }
    }), candidate.domain]
  );
  return Boolean(result.rows[0]);
}

export async function runMailboxVerification(input: {
  clientId: string;
  limit?: number;
  segmentId?: string | null;
  marketId?: string | null;
  workerId?: string;
  workerJobId?: string | null;
}) {
  const pool = getPool();
  const limit = clamp(input.limit, 1, 8, 3);
  const workerId = (input.workerId || "mailbox-verifier").slice(0, 160);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(split_part(c.email,'@',2)))
       c.id,c.client_id,c.prospect_id,c.segment_id,c.market_id,c.email,c.contact_name,c.contact_title,
       c.identity_confidence,c.email_confidence,c.metadata,
       lower(split_part(c.email,'@',2)) AS domain,
       p.source_metadata AS prospect_source_metadata
     FROM connect_contact_candidates c
     JOIN connect_prospects p ON p.id=c.prospect_id AND p.client_id=c.client_id
     JOIN connect_email_verification_cache v ON v.client_id=c.client_id AND lower(v.email)=lower(c.email)
     LEFT JOIN connect_mailbox_domain_state ds ON ds.client_id=c.client_id AND lower(ds.domain)=lower(split_part(c.email,'@',2))
     WHERE c.client_id=$1
       AND ($2::uuid IS NULL OR c.segment_id=$2)
       AND ($3::uuid IS NULL OR c.market_id=$3)
       AND c.email_status IN ('MX_VALID','TEMPORARY')
       AND c.identity_confidence>=85
       AND c.email_confidence>=50
       AND v.syntax_valid=true
       AND v.mx_status='VALID'
       AND p.qualification_status='QUALIFIED'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NULL
       AND p.contact_name IS NOT NULL
       AND p.domain IS NOT NULL
       AND lower(split_part(c.email,'@',2))=lower(p.domain)
       AND (p.source<>'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND (ds.id IS NULL OR (ds.next_probe_at<=now() AND (ds.locked_at IS NULL OR ds.locked_at<now()-interval '15 minutes')))
     ORDER BY lower(split_part(c.email,'@',2)),
              CASE c.source_kind WHEN 'PUBLIC_SITE' THEN 0 WHEN 'LEARNED_PATTERN' THEN 1 ELSE 2 END,
              c.email_confidence DESC,c.identity_confidence DESC,c.last_seen_at ASC
     LIMIT $4`,
    [input.clientId, input.segmentId ?? null, input.marketId ?? null, limit]
  );

  const summary = {
    status: "COMPLETED" as const,
    provider: "ARBORLINE_MAILBOX" as const,
    attempted: 0,
    verified: 0,
    invalid: 0,
    catchAll: 0,
    temporary: 0,
    unknown: 0,
    networkBlocked: 0,
    deferred: 0,
    contactsPromoted: 0,
    outreachReady: 0,
    draftsCreated: 0,
    messagesQueued: 0,
    messagesSent: 0,
    results: [] as Array<Record<string, unknown>>
  };

  for (const raw of rows as CandidateRow[]) {
    const candidate = { ...raw, domain: normalizeDomain(raw.domain) };
    if (!candidate.domain) continue;
    const domainState = await claimDomain(candidate.client_id, candidate.domain, workerId);
    if (!domainState) {
      summary.deferred++;
      continue;
    }

    summary.attempted++;
    const startedAt = Date.now();
    let result: ProbeResult;
    try {
      result = await probeMailbox(candidate.email, candidate.domain);
    } catch (error) {
      result = {
        status: networkBlockedCode(error) ? "NETWORK_BLOCKED" : "TEMPORARY",
        catchAll: "UNKNOWN",
        smtpCode: null,
        responseExcerpt: errorSummary(error),
        mxHost: null,
        tlsUsed: false,
        metadata: { stage: "UNHANDLED", error: errorSummary(error) }
      };
    }

    await recordAttempt({ candidate, workerJobId: input.workerJobId, result, startedAt });
    await updateVerificationEvidence(candidate, result);
    await releaseDomain(candidate.client_id, candidate.domain, result, Number(domainState.consecutive_failures ?? 0));

    let promoted = false;
    if (result.status === "VERIFIED") {
      summary.verified++;
      await learnVerifiedPattern(candidate);
      promoted = await promoteVerifiedCandidate(candidate);
      if (promoted) {
        summary.contactsPromoted++;
        summary.outreachReady++;
      }
    } else if (result.status === "INVALID") summary.invalid++;
    else if (result.status === "CATCH_ALL") summary.catchAll++;
    else if (result.status === "TEMPORARY") summary.temporary++;
    else if (result.status === "NETWORK_BLOCKED") summary.networkBlocked++;
    else summary.unknown++;

    summary.results.push({
      candidateId: candidate.id,
      prospectId: candidate.prospect_id,
      domain: candidate.domain,
      status: result.status,
      catchAll: result.catchAll,
      smtpCode: result.smtpCode,
      mxHost: result.mxHost,
      tlsUsed: result.tlsUsed,
      promoted
    });
  }
  return summary;
}

export async function recordMailboxDeliveryEvidence(input: {
  clientId: string;
  prospectId: string;
  email: string;
  outcome: "DELIVERED" | "BOUNCED" | "FAILED";
  detail?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const domain = normalizeDomain(email.split("@")[1]);
  if (!email || !domain) return;
  const pool = getPool();
  const delivered = input.outcome === "DELIVERED";

  await pool.query(
    `INSERT INTO connect_email_verification_cache
       (client_id,email,domain,syntax_valid,mx_status,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
     VALUES ($1,$2,$3,true,'VALID',$4,false,$5,$6::jsonb,now(),now()+interval '180 days')
     ON CONFLICT (client_id,email) DO UPDATE
     SET smtp_status=CASE WHEN $7 THEN 'VALID' ELSE connect_email_verification_cache.smtp_status END,
         confidence=CASE WHEN $7 THEN GREATEST(connect_email_verification_cache.confidence,100) ELSE connect_email_verification_cache.confidence END,
         evidence=coalesce(connect_email_verification_cache.evidence,'{}'::jsonb)||excluded.evidence,
         checked_at=now(),
         expires_at=CASE WHEN $7 THEN now()+interval '180 days' ELSE connect_email_verification_cache.expires_at END`,
    [input.clientId, email, domain, delivered ? "VALID" : "UNKNOWN", delivered ? 100 : 0, JSON.stringify({
      delivery_observation: {
        outcome: input.outcome,
        detail: input.detail?.slice(0, 500) ?? null,
        observed_at: new Date().toISOString(),
        provider: "RESEND"
      }
    }), delivered]
  );

  if (delivered) {
    const updated = await pool.query(
      `UPDATE connect_contact_candidates
       SET email_status='VERIFIED',email_confidence=GREATEST(email_confidence,100),verified_at=coalesce(verified_at,now()),
           evidence=coalesce(evidence,'[]'::jsonb)||$4::jsonb,last_seen_at=now()
       WHERE client_id=$1 AND prospect_id=$2 AND lower(email)=lower($3)
       RETURNING id,client_id,prospect_id,segment_id,market_id,email,contact_name,contact_title,
                 identity_confidence,email_confidence,metadata,lower(split_part(email,'@',2)) AS domain,
                 '{}'::jsonb AS prospect_source_metadata`,
      [input.clientId, input.prospectId, email, JSON.stringify(["Resend confirmed delivery to this mailbox."])]
    );
    const candidate = updated.rows[0] as CandidateRow | undefined;
    if (candidate) await learnVerifiedPattern(candidate);
  }
}
