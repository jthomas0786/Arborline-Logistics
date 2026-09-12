import { getPool } from "./db";
import {
  CommunicationProviderError,
  communicationsConfig,
  isTestRecipient,
  sendWithResend,
  type OutboxMessage
} from "./communications";
import { NoPushSubscriptionError, sendWithWebPush } from "./web-push";

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
    if (row.channel === "SMS") {
      await pool.query(
        `UPDATE outbox_messages SET status='CANCELLED',attempts=GREATEST(attempts-1,0),last_error='SMS_DISABLED_USE_EMAIL_OR_WEB_PUSH' WHERE id=$1`,
        [row.id]
      );
      await recordEvent(row, "ARBORLINE", "CHANNEL_DISABLED", "cancelled", null, { channel: "SMS" });
      waiting += 1;
      continue;
    }

    if (!new Set(["EMAIL","PUSH"]).has(row.channel)) {
      await pool.query(
        `UPDATE outbox_messages SET status='DEAD_LETTER',failed_at=now(),dead_lettered_at=now(),last_error=$2 WHERE id=$1`,
        [row.id, `Unsupported communication channel: ${row.channel}`]
      );
      deadLettered += 1;
      continue;
    }

    if ((row.channel === "EMAIL" && isTestRecipient(row.recipient)) || await isTestCarrier(row.carrier_id)) {
      await pool.query(
        `UPDATE outbox_messages SET status='SUPPRESSED',attempts=GREATEST(attempts-1,0),provider_status='suppressed',last_error='TEST_ONLY_RECIPIENT' WHERE id=$1`,
        [row.id]
      );
      await recordEvent(row, "ARBORLINE", "SUPPRESSED", "suppressed", null, { reason: "TEST_ONLY_RECIPIENT" });
      suppressed += 1;
      continue;
    }

    if (row.channel === "EMAIL" && !config.emailReady) {
      await pool.query(
        `UPDATE outbox_messages SET status='WAITING_PROVIDER',attempts=GREATEST(attempts-1,0),last_error='RESEND_NOT_CONFIGURED' WHERE id=$1`,
        [row.id]
      );
      waiting += 1;
      continue;
    }

    try {
      const result = row.channel === "EMAIL" ? await sendWithResend(row) : await sendWithWebPush(row);
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
      if (error instanceof NoPushSubscriptionError) {
        await pool.query(
          `UPDATE outbox_messages
           SET status='WAITING_SUBSCRIBER',attempts=GREATEST(attempts-1,0),provider='WEB_PUSH',provider_status='waiting_subscriber',last_error=$2
           WHERE id=$1`,
          [row.id, error.message]
        );
        await recordEvent(row, "WEB_PUSH", "WAITING_SUBSCRIBER", "waiting_subscriber", null);
        waiting += 1;
        continue;
      }

      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown delivery error";
      const attempts = Number(row.attempts ?? 0) + 1;
      const shouldDeadLetter = permanent(error) || attempts >= maxAttempts();
      const provider = row.channel === "EMAIL" ? "RESEND" : "WEB_PUSH";
      if (shouldDeadLetter) {
        await pool.query(
          `UPDATE outbox_messages
           SET status='DEAD_LETTER',failed_at=now(),dead_lettered_at=now(),provider=$2,provider_status='failed',last_error=$3
           WHERE id=$1`,
          [row.id, provider, message]
        );
        await recordEvent(row, provider, "DEAD_LETTER", "failed", null, { error: message });
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
           SET status='PENDING',available_at=now()+($2 * interval '1 minute'),provider=$3,provider_status='retrying',last_error=$4
           WHERE id=$1`,
          [row.id, backoff, provider, message]
        );
        failed += 1;
      }
    }
  }

  return { sent, failed, waiting, suppressed, deadLettered, claimed: claim.rowCount ?? 0, providers: { emailReady: config.emailReady, pushReady: true } };
}
