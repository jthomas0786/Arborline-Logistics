import { createHash, createHmac } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";

const TOKEN_HASH = "b71f4a066b3b6a1c5e900a75012bfcbcc3303c042293863f17e36382db232f11";
const MESSAGE_IDS = [
  "3f78f833-24a1-4687-b147-781247dae93b",
  "ed0c5fbe-d899-4e87-942e-7a98751261ee",
  "42ae3e68-33ae-4406-b681-9383b7dcbaf0"
];
const FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const FROM_EMAIL = "josh@mail.arborlineconnect.com";

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] || c));
}
function baseUrl() { return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, ""); }
function unsubscribeToken(messageId: string, secret: string) {
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
async function vaultSecret(name: string) {
  const { rows } = await getPool().query(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 ORDER BY created_at DESC LIMIT 1`, [name]);
  return String(rows[0]?.decrypted_secret || "").trim();
}
async function sendResend(payload: Record<string, unknown>, key: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY missing");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error(`Resend failed (${r.status}): ${String(data.message || "unknown")}`);
  return String(data.id || "");
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (createHash("sha256").update(token).digest("hex") !== TOKEN_HASH) return new NextResponse("Not found", { status: 404 });

  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('arborline-one-time-pilot-release'))");
    const postal = process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim() || "";
    const secret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || await vaultSecret("connect_unsubscribe_secret");
    if (!postal || !secret) return NextResponse.json({ ok:false, error:"Compliance configuration missing" }, { status:500 });

    const sentToday = await db.query(`SELECT count(*)::int AS count FROM connect_outreach_messages WHERE status IN ('SENT','DELIVERED') AND sent_at >= date_trunc('day', now())`);
    if ((sentToday.rows[0]?.count ?? 0) + MESSAGE_IDS.length > 10) return NextResponse.json({ ok:false, error:"Daily send limit would be exceeded" }, { status:409 });

    const { rows } = await db.query(`SELECT m.id,m.subject,m.body_text,m.recipient_email,m.prospect_id,m.client_id,p.domain,p.contact_email,p.qualification_status,p.outreach_status,p.suppression_status FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.id = ANY($1::uuid[]) ORDER BY m.created_at`, [MESSAGE_IDS]);
    if (rows.length !== 3) return NextResponse.json({ ok:false, error:"Pilot messages not found" }, { status:409 });

    const results: Array<Record<string, unknown>> = [];
    for (const m of rows) {
      if (m.status !== "QUEUED" || m.qualification_status !== "QUALIFIED" || m.outreach_status !== "QUEUED" || m.suppression_status !== "CLEAR" || String(m.contact_email).toLowerCase() !== String(m.recipient_email).toLowerCase()) {
        results.push({ id:m.id, sent:false, reason:"Message no longer eligible" });
        continue;
      }
      const sup = await db.query(`SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=$1) AND ((s.email IS NOT NULL AND lower(s.email)=lower($2)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower($3))) LIMIT 1`, [m.client_id,m.contact_email,m.domain]);
      if (sup.rowCount) { results.push({ id:m.id, sent:false, reason:"Suppressed" }); continue; }

      const uToken = unsubscribeToken(String(m.id), secret);
      const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${uToken}`;
      const text = `${m.body_text}\n\nArborLine Connect\n${postal}\nUnsubscribe: ${unsubscribeUrl}`;
      const htmlBody = escapeHtml(String(m.body_text)).replace(/\n/g, "<br />");
      const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(postal)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;
      const providerId = await sendResend({ from:FROM, reply_to:CONNECT_REPLY_TO, to:[m.recipient_email], subject:m.subject, text, html, headers:{"List-Unsubscribe":`<${unsubscribeUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"} }, `connect-live-${m.id}`);
      await db.query(`UPDATE connect_outreach_messages SET provider_message_id=$2,status='SENT',sent_at=now(),sender_name='Josh Thomas',sender_email=$3,updated_at=now() WHERE id=$1 AND status='QUEUED'`, [m.id,providerId,FROM_EMAIL]);
      await db.query(`UPDATE connect_prospects SET outreach_status='CONTACTED',updated_at=now() WHERE id=$1 AND outreach_status='QUEUED'`, [m.prospect_id]);
      results.push({ id:m.id, sent:true, providerId });
    }
    return NextResponse.json({ ok:results.every(r => r.sent === true), results });
  } catch (e) {
    return NextResponse.json({ ok:false, error:e instanceof Error ? e.message : "Pilot release failed" }, { status:500 });
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext('arborline-one-time-pilot-release'))").catch(() => {});
    db.release();
  }
}
