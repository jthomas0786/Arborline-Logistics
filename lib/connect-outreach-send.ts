import { getPool } from "@/lib/db";
import { CONNECT_FOLLOW_UP_EXPERIMENT_KEY } from "@/lib/connect-outreach-followups";
import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";
import { createConnectUnsubscribeToken, getConnectUnsubscribeSigningSecret } from "@/lib/connect-unsubscribe";
import { connectTextToHtml } from "@/lib/connect-email-html";

const CONNECT_FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HARD_BATCH_CAP = 7;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

function allowedClientIds() {
  return (process.env.CONNECT_AUTOSEND_CLIENT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID.test(value));
}

function runtimeConfig() {
  const liveEnabled = process.env.CONNECT_LIVE_OUTREACH_ENABLED === "true";
  const autosendEnabled = process.env.CONNECT_AUTOSEND_ENABLED === "true";
  const postalAddress = process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim() || "";
  const unsubscribeSecret = getConnectUnsubscribeSigningSecret();
  const dailyLimit = clamp(process.env.CONNECT_DAILY_SEND_LIMIT, 1, 100, 10);
  const batchLimit = clamp(process.env.CONNECT_AUTOSEND_BATCH_LIMIT, 1, HARD_BATCH_CAP, 5);
  const clientIds = allowedClientIds();
  const ready = liveEnabled && autosendEnabled && Boolean(postalAddress) && Boolean(unsubscribeSecret) && clientIds.length > 0;

  return {
    liveEnabled,
    autosendEnabled,
    postalAddress,
    unsubscribeSecret,
    dailyLimit,
    batchLimit,
    allowedClientIds: clientIds,
    ready
  };
}

function safeConfig(config: ReturnType<typeof runtimeConfig>) {
  return {
    liveEnabled: config.liveEnabled,
    autosendEnabled: config.autosendEnabled,
    hasPostalAddress: Boolean(config.postalAddress),
    hasUnsubscribeSecret: Boolean(config.unsubscribeSecret),
    dailyLimit: config.dailyLimit,
    batchLimit: config.batchLimit,
    allowedClients: config.allowedClientIds.length,
    hardBatchCap: HARD_BATCH_CAP,
    ready: config.ready
  };
}

async function sendResend(payload: Record<string, unknown>, idempotencyKey: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Resend is not configured.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Resend failed (${response.status}): ${String(result.message || "unknown error")}`);
  const id = String(result.id || "").trim();
  if (!id) throw new Error("Resend accepted the email without returning an id.");
  return id;
}

type SendAttempt =
  | { outcome: "SENT"; messageId: string; providerId: string }
  | { outcome: "EMPTY" }
  | { outcome: "DAILY_LIMIT" }
  | { outcome: "FAILED"; messageId: string | null; error: string };

async function sendNextAllowedQueuedMessage(config: ReturnType<typeof runtimeConfig>): Promise<SendAttempt> {
  const pool = getPool();
  const client = await pool.connect();
  let messageId: string | null = null;

  try {
    await client.query("BEGIN");

    const sentTodayResult = await client.query(
      `SELECT count(*)::int AS count
       FROM connect_outreach_messages
       WHERE status IN ('SENT','DELIVERED')
         AND sent_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')`
    );
    if (Number(sentTodayResult.rows[0]?.count || 0) >= config.dailyLimit) {
      await client.query("COMMIT");
      return { outcome: "DAILY_LIMIT" };
    }

    const claimed = await client.query(
      `SELECT m.id,m.client_id,m.prospect_id,m.subject,m.body_text,m.recipient_email,m.experiment_key,
              p.domain,p.contact_email
       FROM connect_outreach_messages m
       JOIN connect_prospects p ON p.id=m.prospect_id
       WHERE m.status='QUEUED'
         AND m.provider_message_id IS NULL
         AND m.approved_at IS NOT NULL
         AND m.approved_by_user_id IS NOT NULL
         AND m.approval_source IN ('STAFF_SINGLE','STAFF_BATCH_CONFIRMED','LEGACY_USER_CONFIRMED')
         AND m.client_id = ANY($1::uuid[])
         AND p.qualification_status='QUALIFIED'
         AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
         AND p.outreach_status='QUEUED'
         AND p.suppression_status='CLEAR'
         AND p.contact_email IS NOT NULL
         AND lower(p.contact_email)=lower(m.recipient_email)
         AND public.connect_contact_is_verified(p)
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )
         AND (m.experiment_key <> $2 OR NOT EXISTS (
           SELECT 1 FROM connect_replies r WHERE r.prospect_id=p.id
         ))
       ORDER BY m.updated_at ASC,m.created_at ASC,m.id ASC
       FOR UPDATE OF m,p SKIP LOCKED
       LIMIT 1`,
      [config.allowedClientIds, CONNECT_FOLLOW_UP_EXPERIMENT_KEY]
    );

    const message = claimed.rows[0];
    if (!message) {
      await client.query("COMMIT");
      return { outcome: "EMPTY" };
    }
    messageId = String(message.id);

    const token = createConnectUnsubscribeToken(messageId, config.unsubscribeSecret);
    const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${token}`;
    const body = `${message.body_text}\n\nArborLine Connect\n${config.postalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
    const htmlBody = connectTextToHtml(String(message.body_text));
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(config.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;

    const providerId = await sendResend(
      {
        from: CONNECT_FROM,
        reply_to: CONNECT_REPLY_TO,
        to: [message.recipient_email],
        subject: message.subject,
        text: body,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
      },
      `connect-live-${messageId}`
    );

    const persisted = await client.query(
      `UPDATE connect_outreach_messages
       SET provider='RESEND',provider_message_id=$2,status='SENT',sent_at=now(),
           sender_name='Josh Thomas',sender_email=$3,error_message=NULL,updated_at=now()
       WHERE id=$1
         AND status='QUEUED'
         AND provider_message_id IS NULL
         AND approved_at IS NOT NULL
         AND approved_by_user_id IS NOT NULL
       RETURNING id`,
      [messageId, providerId, CONNECT_FROM_EMAIL]
    );
    if (!persisted.rows[0]) throw new Error("Queued outreach changed before send result could be persisted.");

    await client.query(
      `UPDATE connect_prospects
       SET outreach_status='CONTACTED',updated_at=now()
       WHERE id=$1 AND outreach_status='QUEUED'`,
      [message.prospect_id]
    );

    await client.query("COMMIT");
    return { outcome: "SENT", messageId, providerId };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const message = error instanceof Error ? error.message : "Unknown queued outreach send failure";
    if (messageId) {
      await pool.query(
        `UPDATE connect_outreach_messages
         SET error_message=$2,updated_at=now()
         WHERE id=$1 AND status='QUEUED' AND provider_message_id IS NULL`,
        [messageId, message.slice(0, 1000)]
      ).catch(() => undefined);
    }
    return { outcome: "FAILED", messageId, error: message };
  } finally {
    client.release();
  }
}

export async function previewConnectQueuedOutreach() {
  const config = runtimeConfig();
  const safe = safeConfig(config);
  if (!config.allowedClientIds.length) {
    return { ...safe, eligible: 0, sentToday: 0, remainingDaily: config.dailyLimit };
  }
  const pool = getPool();
  const [eligibleResult, sentResult] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count
       FROM connect_outreach_messages m
       JOIN connect_prospects p ON p.id=m.prospect_id
       WHERE m.status='QUEUED'
         AND m.provider_message_id IS NULL
         AND m.approved_at IS NOT NULL
         AND m.approved_by_user_id IS NOT NULL
         AND m.approval_source IN ('STAFF_SINGLE','STAFF_BATCH_CONFIRMED','LEGACY_USER_CONFIRMED')
         AND m.client_id = ANY($1::uuid[])
         AND p.qualification_status='QUALIFIED'
         AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
         AND p.outreach_status='QUEUED'
         AND p.suppression_status='CLEAR'
         AND p.contact_email IS NOT NULL
         AND lower(p.contact_email)=lower(m.recipient_email)
         AND public.connect_contact_is_verified(p)
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )
         AND (m.experiment_key <> $2 OR NOT EXISTS (
           SELECT 1 FROM connect_replies r WHERE r.prospect_id=p.id
         ))`,
      [config.allowedClientIds, CONNECT_FOLLOW_UP_EXPERIMENT_KEY]
    ),
    pool.query(
      `SELECT count(*)::int AS count
       FROM connect_outreach_messages
       WHERE status IN ('SENT','DELIVERED')
         AND sent_at >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')`
    )
  ]);
  const sentToday = Number(sentResult.rows[0]?.count || 0);
  return {
    ...safe,
    eligible: Number(eligibleResult.rows[0]?.count || 0),
    sentToday,
    remainingDaily: Math.max(0, config.dailyLimit - sentToday)
  };
}

export async function dispatchConnectQueuedOutreach() {
  const config = runtimeConfig();
  const safe = safeConfig(config);
  if (!config.autosendEnabled) {
    return { state: "DISABLED", sent: 0, failed: 0, ...safe };
  }
  if (!config.ready) {
    return {
      state: "BLOCKED",
      sent: 0,
      failed: 0,
      ...safe,
      reason: !config.liveEnabled
        ? "Live outreach master switch is off."
        : !config.postalAddress
          ? "Business postal address is missing."
          : !config.unsubscribeSecret
            ? "Unsubscribe signing secret is missing."
            : "Autosend client allowlist is empty."
    };
  }

  let sent = 0;
  let failed = 0;
  let stoppedBy: "EMPTY" | "DAILY_LIMIT" | "FAILED" | "BATCH_LIMIT" = "BATCH_LIMIT";
  let lastError: string | null = null;

  for (let index = 0; index < config.batchLimit; index += 1) {
    const attempt = await sendNextAllowedQueuedMessage(config);
    if (attempt.outcome === "SENT") {
      sent += 1;
      continue;
    }
    if (attempt.outcome === "FAILED") {
      failed += 1;
      stoppedBy = "FAILED";
      lastError = attempt.error;
      break;
    }
    stoppedBy = attempt.outcome;
    break;
  }

  return {
    state: "ACTIVE",
    sent,
    failed,
    stoppedBy,
    ...safe,
    error: lastError
  };
}
