import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyResendWebhook } from "@/lib/communications";

function eventMessage(data: Record<string, unknown>, type: string) {
  const error = data.error && typeof data.error === "object" ? data.error as Record<string, unknown> : null;
  const bounce = data.bounce && typeof data.bounce === "object" ? data.bounce as Record<string, unknown> : null;
  return String(error?.message ?? bounce?.message ?? bounce?.type ?? type).slice(0, 1000);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyResendWebhook(rawBody, request.headers)) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });

  let event: Record<string, unknown>;
  try { event = JSON.parse(rawBody) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const type = String(event.type ?? "unknown");
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
  const emailId = String(data.email_id ?? data.emailId ?? data.id ?? "").trim();
  const eventId = request.headers.get("svix-id");
  if (!emailId) return NextResponse.json({ error: "Email id is required" }, { status: 400 });

  const pool = getPool();
  const connectResult = await pool.query(
    `SELECT m.id,m.prospect_id,m.client_id,m.recipient_email FROM connect_outreach_messages m
     WHERE m.provider='RESEND' AND m.provider_message_id=$1 LIMIT 1`, [emailId]
  );
  const connectMessage = connectResult.rows[0];
  if (connectMessage) {
    const delivered = type === "email.delivered";
    const bounced = type === "email.bounced";
    const complained = type === "email.complained";
    const failed = type === "email.failed" || type === "email.suppressed";
    const nextStatus = delivered ? "DELIVERED" : bounced ? "BOUNCED" : complained ? "COMPLAINED" : failed ? "FAILED" : "SENT";
    const failure = bounced || complained || failed ? eventMessage(data, type) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE connect_outreach_messages SET status=$2,error_message=COALESCE($3,error_message),
           delivered_at=CASE WHEN $2='DELIVERED' THEN COALESCE(delivered_at,now()) ELSE delivered_at END,updated_at=now()
         WHERE id=$1`, [connectMessage.id, nextStatus, failure]
      );
      if (delivered) await client.query(`UPDATE connect_prospects SET outreach_status='CONTACTED',updated_at=now() WHERE id=$1 AND outreach_status='QUEUED'`, [connectMessage.prospect_id]);
      if (bounced || complained || failed) {
        const reason = complained ? "COMPLAINT" : bounced ? "BOUNCED" : "DO_NOT_CONTACT";
        const suppressionStatus = complained ? "COMPLAINT" : bounced ? "BOUNCED" : "DO_NOT_CONTACT";
        await client.query(
          `INSERT INTO connect_suppressions (client_id,email,reason,source) VALUES ($1,$2,$3,'RESEND_WEBHOOK') ON CONFLICT DO NOTHING`,
          [connectMessage.client_id, connectMessage.recipient_email, reason]
        );
        await client.query(
          `UPDATE connect_prospects SET suppression_status=$2,qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now() WHERE id=$1`,
          [connectMessage.prospect_id, suppressionStatus]
        );
      }
      await client.query("COMMIT");
      return new Response(null, { status: 204 });
    } catch (error) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record Connect Resend webhook" }, { status: 500 });
    } finally { client.release(); }
  }

  const { rows } = await pool.query(
    `SELECT id,load_id,template,recipient FROM outbox_messages WHERE provider='RESEND' AND provider_message_id=$1 LIMIT 1`, [emailId]
  );
  const message = rows[0];
  if (!message) return NextResponse.json({ error: "Message not recorded yet" }, { status: 409 });

  const delivered = type === "email.delivered";
  const failed = ["email.bounced", "email.complained", "email.failed"].includes(type);
  const delayed = type === "email.delivery_delayed";
  const nextStatus = delivered ? "DELIVERED" : failed ? "FAILED" : "SENT";
  const providerStatus = type.replace(/^email\./, "");
  const failure = failed ? eventMessage(data, type) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (eventId) {
      const inserted = await client.query(
        `INSERT INTO communication_delivery_events (outbox_id,provider,provider_event_id,event_type,provider_status,provider_message_id,payload)
         VALUES ($1,'RESEND',$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (provider,provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING RETURNING id`,
        [message.id,eventId,delivered ? "DELIVERED" : failed ? "DELIVERY_FAILED" : delayed ? "DELIVERY_DELAYED" : "STATUS_UPDATE",providerStatus,emailId,JSON.stringify({ type })]
      );
      if (!inserted.rows[0]) { await client.query("COMMIT"); return new Response(null, { status: 204 }); }
    } else {
      await client.query(
        `INSERT INTO communication_delivery_events (outbox_id,provider,event_type,provider_status,provider_message_id,payload) VALUES ($1,'RESEND',$2,$3,$4,$5::jsonb)`,
        [message.id,delivered ? "DELIVERED" : failed ? "DELIVERY_FAILED" : delayed ? "DELIVERY_DELAYED" : "STATUS_UPDATE",providerStatus,emailId,JSON.stringify({ type })]
      );
    }
    await client.query(
      `UPDATE outbox_messages SET provider_status=$2,status=$3,delivered_at=CASE WHEN $4 THEN COALESCE(delivered_at,now()) ELSE delivered_at END,failed_at=CASE WHEN $5 THEN COALESCE(failed_at,now()) ELSE failed_at END,last_error=CASE WHEN $5 THEN $6 ELSE last_error END,last_callback_at=now() WHERE id=$1`,
      [message.id,providerStatus,nextStatus,delivered,failed,failure]
    );
    if (failed && message.load_id) await client.query(
      `INSERT INTO exceptions (load_id,severity,category,description,recommended_action,status)
       SELECT $1,'HIGH','COMMUNICATION_DELIVERY',$2,$3,'OPEN' WHERE NOT EXISTS (SELECT 1 FROM exceptions WHERE load_id=$1 AND category='COMMUNICATION_DELIVERY' AND status IN ('OPEN','ACKNOWLEDGED'))`,
      [message.load_id,`${message.template} email to ${message.recipient} failed delivery.`,"Verify the billing/dispatch email and provider bounce reason before retrying."]
    );
    if (delivered && message.load_id) await client.query(`UPDATE exceptions SET status='RESOLVED',resolved_at=now() WHERE load_id=$1 AND category='COMMUNICATION_DELIVERY' AND status IN ('OPEN','ACKNOWLEDGED')`, [message.load_id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record Resend webhook" }, { status: 500 });
  } finally { client.release(); }
  return new Response(null, { status: 204 });
}
