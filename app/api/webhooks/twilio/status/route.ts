import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyTwilioCallbackToken } from "@/lib/communications";

function normalizedStatus(value: FormDataEntryValue | null) {
  return String(value ?? "unknown").trim().toLowerCase();
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const outboxId = url.searchParams.get("outboxId");
  const token = url.searchParams.get("token");
  if (!outboxId || !/^\d+$/.test(outboxId) || !verifyTwilioCallbackToken(outboxId, token)) {
    return NextResponse.json({ error: "Invalid callback token" }, { status: 401 });
  }

  const form = await request.formData();
  const sid = String(form.get("MessageSid") ?? "").trim();
  const status = normalizedStatus(form.get("MessageStatus"));
  const errorCode = String(form.get("ErrorCode") ?? "").trim();
  const errorMessage = String(form.get("ErrorMessage") ?? "").trim();
  if (!sid) return NextResponse.json({ error: "MessageSid is required" }, { status: 400 });

  const pool = getPool();
  const { rows } = await pool.query(`SELECT id,load_id,provider_message_id,template,recipient FROM outbox_messages WHERE id=$1`, [outboxId]);
  const message = rows[0];
  if (!message) return NextResponse.json({ error: "Outbox message not found" }, { status: 404 });
  if (message.provider_message_id && message.provider_message_id !== sid) {
    return NextResponse.json({ error: "Message SID does not match the outbox record" }, { status: 409 });
  }

  const delivered = status === "delivered" || status === "read";
  const failed = status === "failed" || status === "undelivered";
  const nextStatus = delivered ? "DELIVERED" : failed ? "FAILED" : "SENT";
  const failure = [errorCode, errorMessage].filter(Boolean).join(": ") || (failed ? `Twilio status ${status}` : null);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE outbox_messages
       SET provider='TWILIO',provider_message_id=COALESCE(provider_message_id,$2),provider_status=$3,status=$4,
           delivered_at=CASE WHEN $5 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,
           failed_at=CASE WHEN $6 THEN COALESCE(failed_at,now()) ELSE failed_at END,
           last_error=CASE WHEN $6 THEN $7 ELSE last_error END,last_callback_at=now()
       WHERE id=$1`,
      [outboxId, sid, status, nextStatus, delivered, failed, failure]
    );
    await client.query(
      `INSERT INTO communication_delivery_events (outbox_id,provider,event_type,provider_status,provider_message_id,payload)
       VALUES ($1,'TWILIO',$2,$3,$4,$5::jsonb)`,
      [outboxId, delivered ? "DELIVERED" : failed ? "DELIVERY_FAILED" : "STATUS_UPDATE", status, sid, JSON.stringify({ ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) })]
    );
    if (failed && message.load_id) {
      await client.query(
        `INSERT INTO exceptions (load_id,severity,category,description,recommended_action,status)
         SELECT $1,'HIGH','COMMUNICATION_DELIVERY',$2,$3,'OPEN'
         WHERE NOT EXISTS (
           SELECT 1 FROM exceptions WHERE load_id=$1 AND category='COMMUNICATION_DELIVERY' AND status IN ('OPEN','ACKNOWLEDGED')
         )`,
        [message.load_id, `${message.template} SMS to ${message.recipient} failed delivery.`, "Verify the phone number and messaging compliance/provider error before retrying."]
      );
    }
    if (delivered && message.load_id) {
      await client.query(
        `UPDATE exceptions SET status='RESOLVED',resolved_at=now()
         WHERE load_id=$1 AND category='COMMUNICATION_DELIVERY' AND status IN ('OPEN','ACKNOWLEDGED')`,
        [message.load_id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record Twilio callback" }, { status: 500 });
  } finally {
    client.release();
  }

  return new Response(null, { status: 204 });
}
