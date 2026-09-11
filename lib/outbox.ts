import { getPool } from "./db";

type OutboxRow = {
  id: string;
  load_id: string | null;
  carrier_id: string | null;
  channel: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function absoluteActionUrl(payload: Record<string, unknown>) {
  const candidate = typeof payload.offerPath === "string"
    ? payload.offerPath
    : typeof payload.invitePath === "string"
      ? payload.invitePath
      : typeof payload.trackingPath === "string"
        ? payload.trackingPath
        : null;
  if (!candidate) return null;
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
}

export async function dispatchOutbox(limit = 25) {
  const pool = getPool();
  const url = process.env.OUTBOUND_WEBHOOK_URL;
  if (!url) {
    const { rows } = await pool.query(`SELECT count(*)::int count FROM outbox_messages WHERE status IN ('PENDING','WAITING_PROVIDER')`);
    return { sent: 0, failed: 0, waiting: Number(rows[0]?.count ?? 0), reason: "OUTBOUND_WEBHOOK_URL_NOT_CONFIGURED" };
  }

  const claim = await pool.query(
    `WITH picked AS (
       SELECT id FROM outbox_messages
       WHERE status IN ('PENDING','WAITING_PROVIDER') AND available_at<=now()
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
     )
     UPDATE outbox_messages m SET status='PROCESSING',attempts=m.attempts+1
     FROM picked WHERE m.id=picked.id
     RETURNING m.*`,
    [Math.max(1, Math.min(100, limit))]
  );

  let sent = 0;
  let failed = 0;
  let waiting = 0;
  for (const row of claim.rows as OutboxRow[]) {
    if (row.channel === "SYSTEM" || row.recipient.startsWith("carrier:")) {
      await pool.query(`UPDATE outbox_messages SET status='WAITING_CONTACT',last_error='Carrier dispatch contact is not configured' WHERE id=$1`, [row.id]);
      waiting += 1;
      continue;
    }

    const actionUrl = absoluteActionUrl(row.payload);
    const payload = { ...row.payload, ...(actionUrl ? { actionUrl } : {}) };
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          ...(process.env.OUTBOUND_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.OUTBOUND_WEBHOOK_TOKEN}` } : {})
        },
        body: JSON.stringify({ id: row.id, loadId: row.load_id, carrierId: row.carrier_id, channel: row.channel, recipient: row.recipient, template: row.template, payload })
      });
      if (!response.ok) throw new Error(`Outbound provider returned ${response.status}`);
      await pool.query(`UPDATE outbox_messages SET status='SENT',sent_at=now(),last_error=NULL WHERE id=$1`, [row.id]);
      sent += 1;
    } catch (error) {
      const backoff = Math.min(60, Math.max(5, 2 ** Math.min(row.attempts + 1, 5)));
      await pool.query(`UPDATE outbox_messages SET status='PENDING',available_at=now()+($2 * interval '1 minute'),last_error=$3 WHERE id=$1`, [row.id, backoff, error instanceof Error ? error.message : "Unknown delivery error"]);
      failed += 1;
    }
  }
  return { sent, failed, waiting, claimed: claim.rowCount ?? 0 };
}
