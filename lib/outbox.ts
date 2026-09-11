import { getPool } from "./db";
import {
  CommunicationProviderError,
  communicationsConfig,
  deploymentBaseUrl,
  isTestRecipient,
  sendWithResend,
  sendWithTwilio,
  type OutboxMessage
} from "./communications";

const maxAttempts = () => {
  const parsed = Number(process.env.COMMUNICATIONS_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.round(parsed))) : 5;
};

async function recordEvent(message: OutboxMessage, provider: string, eventType: string, providerStatus: string | null, providerMessageId: string | null, payload: Record<string, unknown> = {}) {
  await getPool().query(
    `INSERT INTO communication_delivery_events (outbox_id,provider,event_type,provider_status,provider_message_id,payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [message.id, provider, eventType, providerStatus, providerMessageId, JSON.stringify(payload)]
  );
}

async function isTestCarrier(carrierId: string | null) {
  if (!carrierId) return false;
  const { rows } = await getPool().query(`SELECT is_test_carrier FROM carriers WHERE id=$1`, [carrierId]);
  return rows[0]?.is_test_carrier === true;
}

function actionUrl(payload: Record<string, unknown>) {
  const path = typeof payload.offerPath === "string" ? payload.offerPath
    : typeof payload.invitePath === "string" ? payload.invitePath
      : typeof payload.trackingPath === "string" ? payload.trackingPath
        : null;
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${deploymentBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

async function sendLegacyWebhook(message: OutboxMessage) {
  const url = process.env.OUTBOUND_WEBHOOK_URL?.trim();
  if (!url) throw new CommunicationProviderError("Legacy outbound webhook is not configured.");
  const link = actionUrl(message.payload);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      ...(process.env.OUTBOUND_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.OUTBOUND_WEBHOOK_TOKEN}` } : {})
    },
    body: JSON.stringify({
      id: message.id,
      loadId: message.load_id,
      carrierId: message.carrier_id,
      channel: message.channel,
      recipient: message.recipient,
      template: message.template,
      payload: { ...message.payload, ...(link ? { actionUrl: link } : {}) }
    })
  });
  if (!response.ok) throw new CommunicationProviderError(`Outbound webhook returned ${response.status}`, response.status);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return {
    provider: "WEBHOOK",
    providerMessageId: body.id ? String(body.id) : `outbox-${message.id}`,
    providerStatus: "accepted",
    metadata: {} as Record<string, unknown>
  };
}

function providerMissingReason(channel: string) {
  return channel === "EMAIL" ? "RESEND_NOT_CONFIGURED" : channel === "SMS" ? "TWILIO_NOT_CONFIGURED" : "DELIVERY_PROVIDER_NOT_CONFIGURED";
}

function retryDelayMinutes(attempts: number) {
  return Math.min(60, Math.max(2, 2 ** Math.min(Math.max(attempts, 1), 5)));
}

function permanent(error: unknown) {
  if (!(error instanceof CommunicationProviderError) || error.statusCode === null) return false;
  return error.statusCode >= 400 && error.statusCode < 500 && ![408, 409, 425, 429].includes(error.statusCode);
}

export async function dispatchOutbox(limit = 25) {
  const pool = getPool();
  const config = communicationsConfig();
  const claim = await pool.query(
    `WITH picked AS (
       SELECT id FROM outbox_messages
       WHERE status IN ('PENDING','WAITING_PROVIDER') AND available_at<=now()
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
     )
     UPDATE outbox_messages m
     SET status='PROCESSING',attempts=m.attempts+1,last_error=NULL
     FROM picked WHERE m.id=picked.id
     RETURNING m.*`,
    [Math.max(1, Math.min(100, limit))]
  );

  let sent = 0;
  let failed = 0;
  let waiting = 0;
  let suppressed = 0;
  let deadLettered = 0;

  for (const row of claim.rows as OutboxMessage[]) {
    if (row.channel === "SYSTEM" || row.recipient.startsWith("carrier:")) {
      await pool.query(
        `UPDATE outbox_messages SET status='WAITING_CONTACT',attempts=GREATEST(attempts-1,0),last_error='Carrier dispatch contact is not configured' WHERE id=$1`,
        [row.id]
      );
      waiting += 1;
      continue;
    }

    if (isTestRecipient(row.recipient) || await isTestCarrier(row.carrier_id)) {
      await pool.query(
        `UPDATE outbox_messages SET status='SUPPRESSED',attempts=GREATEST(attempts-1,0),provider_status='suppressed',last_error='TEST_ONLY_RECIPIENT' WHERE id=$1`,
        [row.id]
      );
      await recordEvent(row, "ARBORLINE", "SUPPRESSED", "suppressed", null, { reason: "TEST_ONLY_RECIPIENT" });
      suppressed += 1;
      continue;
    }

    const hasDirectProvider = row.channel === "EMAIL" ? config.emailReady : row.channel === "SMS" ? config.smsReady : false;
    if (!hasDirectProvider && !config.legacyReady) {
      const reason = providerMissingReason(row.channel);
      await pool.query(
        `UPDATE outbox_messages SET status='WAITING_PROVIDER',attempts=GREATEST(attempts-1,0),last_error=$2 WHERE id=$1`,
        [row.id, reason]
      );
      waiting += 1;
      continue;
    }

    try {
      const result = hasDirectProvider
        ? row.channel === "EMAIL" ? await sendWithResend(row) : await sendWithTwilio(row)
        : await sendLegacyWebhook(row);
      await pool.query(
        `UPDATE outbox_messages
         SET status='SENT',provider=$2,provider_message_id=$3,provider_status=$4,
             provider_metadata=$5::jsonb,accepted_at=COALESCE(accepted_at,now()),sent_at=COALESCE(sent_at,now()),last_error=NULL
         WHERE id=$1`,
        [row.id, result.provider, result.providerMessageId, result.providerStatus, JSON.stringify(result.metadata)]
      );
      await recordEvent(row, result.provider, "PROVIDER_ACCEPTED", result.providerStatus, result.providerMessageId, result.metadata);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown delivery error";
      const attempts = Number(row.attempts ?? 0) + 1;
      const shouldDeadLetter = permanent(error) || attempts >= maxAttempts();
      if (shouldDeadLetter) {
        await pool.query(
          `UPDATE outbox_messages
           SET status='DEAD_LETTER',failed_at=now(),dead_lettered_at=now(),provider_status='failed',last_error=$2
           WHERE id=$1`,
          [row.id, message]
        );
        await recordEvent(row, row.channel === "EMAIL" ? "RESEND" : row.channel === "SMS" ? "TWILIO" : "WEBHOOK", "DEAD_LETTER", "failed", null, { error: message });
        if (row.load_id) {
          await pool.query(
            `INSERT INTO exceptions (load_id,severity,category,description,recommended_action,status)
             SELECT $1,'HIGH','COMMUNICATION_DELIVERY',$2,$3,'OPEN'
             WHERE NOT EXISTS (
               SELECT 1 FROM exceptions WHERE load_id=$1 AND category='COMMUNICATION_DELIVERY' AND status IN ('OPEN','ACKNOWLEDGED')
             )`,
            [row.load_id, `${row.template} to ${row.recipient} could not be delivered.`, "Review the recipient/provider error, correct contact information if needed, then retry the communication."]
          );
        }
        deadLettered += 1;
      } else {
        const backoff = retryDelayMinutes(attempts);
        await pool.query(
          `UPDATE outbox_messages
           SET status='PENDING',available_at=now()+($2 * interval '1 minute'),provider_status='retrying',last_error=$3
           WHERE id=$1`,
          [row.id, backoff, message]
        );
        failed += 1;
      }
    }
  }

  return { sent, failed, waiting, suppressed, deadLettered, claimed: claim.rowCount ?? 0, providers: config };
}
