import { createHmac } from "crypto";
import { getPool } from "@/lib/db";
import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";
import { connectWalkthroughVideoAvailable } from "@/lib/connect-walkthrough-video";

const CONNECT_FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";
const WALKTHROUGH_SUBJECT = "Your ArborLine 2-minute walkthrough";

function baseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char));
}

function unsubscribeToken(messageId: string, secret: string) {
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function config() {
  const autoSendEnabled = process.env.CONNECT_WALKTHROUGH_AUTO_SEND_ENABLED === "true";
  const walkthroughUrl = process.env.CONNECT_WALKTHROUGH_URL?.trim() || `${baseUrl()}/walkthrough`;
  const postalAddress = process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim() || "";
  const unsubscribeSecret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || "";
  let validWalkthroughUrl = false;
  try {
    validWalkthroughUrl = new URL(walkthroughUrl).protocol === "https:";
  } catch {
    validWalkthroughUrl = false;
  }
  return {
    autoSendEnabled,
    walkthroughUrl,
    postalAddress,
    unsubscribeSecret,
    validWalkthroughUrl,
    ready: autoSendEnabled && validWalkthroughUrl && Boolean(postalAddress) && Boolean(unsubscribeSecret)
  };
}

async function resend(payload: Record<string, unknown>, idempotencyKey: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
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
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Resend walkthrough send failed (${response.status}): ${String(data.message || "unknown error")}`);
  const id = String(data.id || "");
  if (!id) throw new Error("Resend accepted the walkthrough email without returning an id.");
  return id;
}

export function walkthroughAutomationConfigured() {
  return config().ready;
}

export async function sendRequestedConnectWalkthrough(input: {
  replyId: string;
  clientId: string;
  prospectId: string;
  recipientEmail: string;
  contactName?: string | null;
  companyName?: string | null;
}) {
  const cfg = config();
  if (!cfg.ready) {
    const missing = [
      !cfg.autoSendEnabled ? "CONNECT_WALKTHROUGH_AUTO_SEND_ENABLED" : null,
      !cfg.validWalkthroughUrl ? "valid HTTPS walkthrough URL" : null,
      !cfg.postalAddress ? "CONNECT_BUSINESS_POSTAL_ADDRESS" : null,
      !cfg.unsubscribeSecret ? "CONNECT_UNSUBSCRIBE_SECRET" : null
    ].filter(Boolean).join(", ");
    return {
      sent: false,
      alreadySent: false,
      blocked: true,
      reason: `Walkthrough auto-send is not fully configured${missing ? `: ${missing}` : "."}`
    };
  }

  const videoAvailable = await connectWalkthroughVideoAvailable();
  if (!videoAvailable) {
    return {
      sent: false,
      alreadySent: false,
      blocked: true,
      reason: "The approved ArborLine walkthrough video is not available yet."
    };
  }

  const pool = getPool();
  const prospect = await pool.query(
    `SELECT p.id,p.domain,p.suppression_status,p.contact_email,
            EXISTS (
              SELECT 1 FROM connect_suppressions s
              WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
                AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
                  OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
            ) AS is_suppressed
     FROM connect_prospects p
     WHERE p.id=$1 AND p.client_id=$2 AND p.contact_email IS NOT NULL
       AND lower(p.contact_email)=lower($3)
     LIMIT 1`,
    [input.prospectId, input.clientId, input.recipientEmail]
  );
  const person = prospect.rows[0];
  if (!person || person.suppression_status !== "CLEAR" || person.is_suppressed) {
    return { sent: false, alreadySent: false, blocked: true, reason: "Prospect is suppressed or no longer matches the verified recipient." };
  }

  const existing = await pool.query(
    `SELECT id,status,provider_message_id
     FROM connect_outreach_messages
     WHERE prospect_id=$1 AND client_id=$2 AND lower(recipient_email)=lower($3)
       AND subject=$4 AND status IN ('QUEUED','SENT','DELIVERED')
     ORDER BY created_at DESC LIMIT 1`,
    [input.prospectId, input.clientId, input.recipientEmail, WALKTHROUGH_SUBJECT]
  );
  if (existing.rows[0]?.status === "SENT" || existing.rows[0]?.status === "DELIVERED") {
    return { sent: false, alreadySent: true, blocked: false, providerMessageId: existing.rows[0].provider_message_id || null };
  }

  const firstName = String(input.contactName || "there").trim().split(/\s+/)[0] || "there";
  const company = String(input.companyName || "your business").trim() || "your business";
  const messageBody = `Hi ${firstName},\n\nAbsolutely — here’s the short ArborLine walkthrough I mentioned:\n\n${cfg.walkthroughUrl}\n\nIt gives a quick look at how ArborLine can help a recurring-service business like ${company} find matching companies, identify decision-makers, qualify opportunities, and keep interested replies organized.\n\nIf anything stands out or you have a question after watching it, just reply here.\n\nBest,\nJosh Thomas\nFounder, ArborLine Connect`;

  let message = existing.rows[0] ?? null;
  if (!message) {
    const inserted = await pool.query(
      `INSERT INTO connect_outreach_messages
        (prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status)
       VALUES ($1,$2,'Josh Thomas',$3,$4,$5,$6,'QUEUED')
       RETURNING id,status,provider_message_id`,
      [input.prospectId, input.clientId, CONNECT_FROM_EMAIL, input.recipientEmail, WALKTHROUGH_SUBJECT, messageBody]
    );
    message = inserted.rows[0];
  }

  const token = unsubscribeToken(String(message.id), cfg.unsubscribeSecret);
  const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${token}`;
  const text = `${messageBody}\n\nArborLine Connect\n${cfg.postalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
  const htmlBody = escapeHtml(messageBody).replace(/\n/g, "<br />");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(cfg.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;

  const providerId = await resend(
    {
      from: CONNECT_FROM,
      reply_to: CONNECT_REPLY_TO,
      to: [input.recipientEmail],
      subject: WALKTHROUGH_SUBJECT,
      text,
      html,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    },
    `connect-walkthrough-${message.id}`
  );

  await pool.query(
    `UPDATE connect_outreach_messages
     SET provider_message_id=$2,status='SENT',sent_at=coalesce(sent_at,now()),sender_name='Josh Thomas',sender_email=$3,updated_at=now()
     WHERE id=$1 AND status='QUEUED'`,
    [message.id, providerId, CONNECT_FROM_EMAIL]
  );

  return { sent: true, alreadySent: false, blocked: false, providerMessageId: providerId, replyId: input.replyId };
}
