"use server";

import { createHmac } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { buildConnectOutreachDraft } from "@/lib/connect-outreach-drafts";
import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";

const CONNECT_FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";

function text(form: FormData, name: string, max = 1000) { return String(form.get(name) ?? "").trim().slice(0, max); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200; }
function escapeHtml(value: string) { return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char)); }

function complianceConfig() {
  const liveEnabled = process.env.CONNECT_LIVE_OUTREACH_ENABLED === "true";
  const postalAddress = process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim() || "";
  const unsubscribeSecret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || "";
  const dailyLimit = Math.max(1, Math.min(100, Number(process.env.CONNECT_DAILY_SEND_LIMIT || 10) || 10));
  return { liveEnabled, postalAddress, unsubscribeSecret, dailyLimit, ready: liveEnabled && Boolean(postalAddress) && Boolean(unsubscribeSecret) };
}

function unsubscribeToken(messageId: string, secret: string) {
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function baseUrl() { return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, ""); }

async function approveMessage(messageId: string) {
  const pool = getPool();
  const result = await pool.query(`UPDATE connect_outreach_messages m SET status='QUEUED',updated_at=now() FROM connect_prospects p WHERE m.id=$1 AND m.prospect_id=p.id AND m.status='DRAFT' AND p.qualification_status='QUALIFIED' AND p.outreach_status='READY' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL AND lower(p.contact_email)=lower(m.recipient_email) AND NOT EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=p.client_id) AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))) RETURNING m.prospect_id`, [messageId]);
  if (!result.rows[0]?.prospect_id) return false;
  await pool.query(`UPDATE connect_prospects SET outreach_status='QUEUED',updated_at=now() WHERE id=$1 AND outreach_status='READY'`, [result.rows[0].prospect_id]);
  return true;
}

async function loadApprovedMessage(messageId: string) {
  const { rows } = await getPool().query(`SELECT m.id,m.subject,m.body_text,m.recipient_email,m.client_id,m.prospect_id,p.company_name,p.domain,p.contact_email,p.qualification_status,p.outreach_status,p.suppression_status FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.id=$1 AND m.status='QUEUED' AND p.qualification_status='QUALIFIED' AND p.outreach_status='QUEUED' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL AND lower(p.contact_email)=lower(m.recipient_email) AND NOT EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=p.client_id) AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))) LIMIT 1`, [messageId]);
  return rows[0] ?? null;
}

async function resend(payload: Record<string, unknown>, idempotencyKey: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Resend is not configured.");
  const response = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Resend failed (${response.status}): ${String(result.message || "unknown error")}`);
  const id = String(result.id || "");
  if (!id) throw new Error("Resend accepted the email without returning an id.");
  return id;
}

export async function generateReadyOutreachDrafts(form: FormData) {
  await requirePageRole(["STAFF"]); const clientId = text(form, "clientId", 60); if (!clientId) redirect("/campaigns?drafts=client_required");
  const pool = getPool();
  const { rows } = await pool.query(`SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type FROM connect_prospects p JOIN connect_clients c ON c.id=p.client_id WHERE p.client_id=$1 AND p.qualification_status='QUALIFIED' AND p.outreach_status='READY' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM connect_outreach_messages m WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')) ORDER BY p.qualification_score DESC,p.updated_at DESC LIMIT 25`, [clientId]);
  let generated = 0;
  for (const prospect of rows) {
    const { subject, body } = buildConnectOutreachDraft(prospect);
    const result = await pool.query(`INSERT INTO connect_outreach_messages (prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status) SELECT $1,$2,'Josh Thomas',$3,$4,$5,$6,'DRAFT' WHERE NOT EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=$2) AND ((s.email IS NOT NULL AND lower(s.email)=lower($4)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower($7))) RETURNING id`, [prospect.id, prospect.client_id, CONNECT_FROM_EMAIL, prospect.contact_email, subject, body, prospect.domain]);
    generated += result.rowCount ?? 0;
  }
  revalidatePath("/campaigns"); revalidatePath("/prospects"); revalidatePath("/growth"); redirect(`/campaigns?drafts=generated&count=${generated}`);
}

export async function approveOutreachDraft(form: FormData) { await requirePageRole(["STAFF"]); const messageId=text(form,"messageId",60); if(!messageId) redirect("/campaigns?approval=missing"); const approved=await approveMessage(messageId); revalidatePath("/campaigns"); revalidatePath("/prospects"); revalidatePath("/growth"); redirect(`/campaigns?approval=${approved?"approved":"blocked"}&count=${approved?1:0}`); }
export async function rejectOutreachDraft(form: FormData) { await requirePageRole(["STAFF"]); const messageId=text(form,"messageId",60); if(!messageId) redirect("/campaigns?approval=missing"); await getPool().query(`UPDATE connect_outreach_messages SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status='DRAFT'`,[messageId]); revalidatePath("/campaigns"); revalidatePath("/growth"); redirect("/campaigns?approval=rejected&count=1"); }
export async function approveAllDrafts(form: FormData) { await requirePageRole(["STAFF"]); const clientId=text(form,"clientId",60); if(!clientId) redirect("/campaigns?approval=client_required"); const {rows}=await getPool().query(`SELECT id FROM connect_outreach_messages WHERE client_id=$1 AND status='DRAFT' ORDER BY created_at LIMIT 50`,[clientId]); let approved=0; for(const row of rows) if(await approveMessage(row.id)) approved+=1; revalidatePath("/campaigns"); revalidatePath("/prospects"); revalidatePath("/growth"); redirect(`/campaigns?approval=batch&count=${approved}`); }

export async function sendApprovedOutreachTest(form: FormData) {
  await requirePageRole(["STAFF"]); const messageId=text(form,"messageId",60); const testRecipient=text(form,"testRecipient",200).toLowerCase(); if(!messageId||!validEmail(testRecipient)) redirect("/campaigns?test=invalid");
  const message=await loadApprovedMessage(messageId); if(!message) redirect("/campaigns?test=blocked");
  const htmlBody=escapeHtml(String(message.body_text)).replace(/\n/g,"<br />");
  await resend({ from: CONNECT_FROM, reply_to: CONNECT_REPLY_TO, to:[testRecipient], subject:`[ARBORLINE TEST] ${message.subject}`, text:`CONTROLLED TEST — no prospect was contacted.\nIntended prospect: ${message.company_name} <${message.recipient_email}>\n\n${message.body_text}`, html:`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033"><div style="padding:12px 16px;background:#eef5ff;border-radius:10px;margin-bottom:18px"><strong>ArborLine Connect controlled test</strong><br/>No prospect was contacted.<br/>Intended prospect: ${escapeHtml(String(message.company_name))} &lt;${escapeHtml(String(message.recipient_email))}&gt;</div><div style="line-height:1.6">${htmlBody}</div></div>` }, `connect-test-${message.id}-${testRecipient}`);
  revalidatePath("/campaigns"); redirect("/campaigns?test=sent");
}

export async function sendApprovedOutreachLive(form: FormData) {
  await requirePageRole(["STAFF"]);
  const messageId=text(form,"messageId",60); const config=complianceConfig();
  if (!messageId || !config.ready) redirect("/campaigns?live=locked");
  const message=await loadApprovedMessage(messageId); if(!message) redirect("/campaigns?live=blocked");
  const pool=getPool();
  const sentToday=await pool.query(`SELECT count(*)::int AS count FROM connect_outreach_messages WHERE status IN ('SENT','DELIVERED') AND sent_at >= date_trunc('day', now())`);
  if ((sentToday.rows[0]?.count ?? 0) >= config.dailyLimit) redirect("/campaigns?live=limit");
  const token=unsubscribeToken(String(message.id),config.unsubscribeSecret);
  const unsubscribeUrl=`${baseUrl()}/api/public/connect-unsubscribe/${token}`;
  const body=`${message.body_text}\n\nArborLine Connect\n${config.postalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
  const htmlBody=escapeHtml(String(message.body_text)).replace(/\n/g,"<br />");
  const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(config.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;
  const providerId=await resend({ from:CONNECT_FROM, reply_to:CONNECT_REPLY_TO, to:[message.recipient_email], subject:message.subject, text:body, html, headers:{"List-Unsubscribe":`<${unsubscribeUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"} }, `connect-live-${message.id}`);
  await pool.query(`UPDATE connect_outreach_messages SET provider_message_id=$2,status='SENT',sent_at=now(),sender_name='Josh Thomas',sender_email=$3,updated_at=now() WHERE id=$1 AND status='QUEUED'`,[message.id,providerId,CONNECT_FROM_EMAIL]);
  await pool.query(`UPDATE connect_prospects SET outreach_status='CONTACTED',updated_at=now() WHERE id=$1 AND outreach_status='QUEUED'`,[message.prospect_id]);
  revalidatePath("/campaigns"); revalidatePath("/prospects"); revalidatePath("/growth"); redirect("/campaigns?live=sent");
}
