import { getPool } from "@/lib/db";

type StaleMessage = {
  id: string;
  prospect_id: string;
  client_id: string;
  recipient_email: string;
  provider_message_id: string;
  sent_at: string | Date | null;
};

type ResendEmail = {
  id?: unknown;
  last_event?: unknown;
};

type ReconciledStatus = "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED" | "SENT" | null;

function mapResendEvent(value: unknown): ReconciledStatus {
  const event = String(value ?? "").trim().toLowerCase();
  if (["delivered", "opened", "clicked"].includes(event)) return "DELIVERED";
  if (event === "bounced") return "BOUNCED";
  if (event === "complained") return "COMPLAINED";
  if (["failed", "suppressed"].includes(event)) return "FAILED";
  if (["sent", "delivery_delayed"].includes(event)) return "SENT";
  return null;
}

async function retrieveResendState(apiKey: string, emailId: string) {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json"
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`RESEND_RETRIEVE_${response.status}`);
  const body = await response.json() as ResendEmail;
  return mapResendEvent(body.last_event);
}

export async function reconcileStaleConnectResendDeliveries(limit = 50) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { checked: 0, updated: 0, delivered: 0, terminal: 0, unresolved: 0, skipped: "RESEND_API_KEY_MISSING" };

  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit || 50)));
  const stale = await pool.query<StaleMessage>(
    `SELECT id,prospect_id,client_id,recipient_email,provider_message_id,sent_at
     FROM connect_outreach_messages
     WHERE upper(coalesce(provider,''))='RESEND'
       AND status='SENT'
       AND provider_message_id IS NOT NULL
       AND sent_at IS NOT NULL
       AND sent_at < now() - interval '15 minutes'
     ORDER BY sent_at ASC
     LIMIT $1`,
    [safeLimit]
  );

  let updated = 0;
  let delivered = 0;
  let terminal = 0;
  let unresolved = 0;

  for (const message of stale.rows) {
    try {
      const nextStatus = await retrieveResendState(apiKey, message.provider_message_id);
      if (!nextStatus || nextStatus === "SENT") {
        unresolved += 1;
        continue;
      }

      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const result = await db.query(
          `UPDATE connect_outreach_messages
           SET provider='RESEND',
               status=$2,
               delivered_at=CASE WHEN $2='DELIVERED' THEN coalesce(delivered_at,sent_at,now()) ELSE delivered_at END,
               error_message=CASE WHEN $2 IN ('BOUNCED','COMPLAINED','FAILED') THEN coalesce(error_message,$3) ELSE error_message END,
               updated_at=now()
           WHERE id=$1 AND status='SENT'
           RETURNING id`,
          [message.id, nextStatus, `Reconciled from Resend provider state: ${nextStatus.toLowerCase()}.`]
        );
        if (!result.rows[0]) {
          await db.query("ROLLBACK");
          continue;
        }

        if (nextStatus === "DELIVERED") {
          await db.query(
            `UPDATE connect_prospects
             SET outreach_status='CONTACTED',updated_at=now()
             WHERE id=$1 AND outreach_status='QUEUED'`,
            [message.prospect_id]
          );
          delivered += 1;
        } else {
          const reason = nextStatus === "COMPLAINED" ? "COMPLAINT" : nextStatus === "BOUNCED" ? "BOUNCED" : "DO_NOT_CONTACT";
          const suppressionStatus = nextStatus === "COMPLAINED" ? "COMPLAINT" : nextStatus === "BOUNCED" ? "BOUNCED" : "DO_NOT_CONTACT";
          await db.query(
            `INSERT INTO connect_suppressions (client_id,email,reason,source)
             VALUES ($1,$2,$3,'RESEND_RECONCILIATION')
             ON CONFLICT DO NOTHING`,
            [message.client_id, message.recipient_email, reason]
          );
          await db.query(
            `UPDATE connect_prospects
             SET suppression_status=$2,qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now()
             WHERE id=$1`,
            [message.prospect_id, suppressionStatus]
          );
          terminal += 1;
        }
        await db.query("COMMIT");
        updated += 1;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    } catch (error) {
      unresolved += 1;
      console.error("[connect-resend-reconcile] unable to reconcile provider state", {
        messageId: message.id,
        providerMessageId: message.provider_message_id,
        error: error instanceof Error ? error.message : "UNKNOWN"
      });
    }
  }

  return { checked: stale.rows.length, updated, delivered, terminal, unresolved };
}
