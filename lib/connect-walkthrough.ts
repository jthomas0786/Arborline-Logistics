import { createHmac } from "crypto";
import { getPool } from "@/lib/db";
import { CONNECT_REPLY_TO } from "@/lib/connect-reply-routing";
import { connectWalkthroughVideoAvailable } from "@/lib/connect-walkthrough-video";

const CONNECT_FROM = "Josh Thomas <josh@mail.arborlineconnect.com>";
const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";
export const CONNECT_VIDEO_SUBJECT = "Your ArborLine 90-second video";
const LEGACY_WALKTHROUGH_SUBJECT = "Your ArborLine 2-minute walkthrough";
const WALKTHROUGH_UNSUBSCRIBE_VAULT_NAME = "connect_unsubscribe_secret";

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
  const walkthroughUrl = process.env.CONNECT_WALKTHROUGH_URL?.trim() || `${baseUrl()}/walkthrough`;
  const postalAddress = process.env.CONNECT_BUSINESS_POSTAL_ADDRESS?.trim() || "";
  let validWalkthroughUrl = false;
  try {
    validWalkthroughUrl = new URL(walkthroughUrl).protocol === "https:";
  } catch {
    validWalkthroughUrl = false;
  }
  return {
    walkthroughUrl,
    postalAddress,
    validWalkthroughUrl,
    sendReadyBase: validWalkthroughUrl && Boolean(postalAddress)
  };
}

async function getUnsubscribeSecret() {
  const envSecret = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim();
  if (envSecret) return envSecret;
  try {
    const result = await getPool().query(
      `SELECT decrypted_secret
       FROM vault.decrypted_secrets
       WHERE name=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [WALKTHROUGH_UNSUBSCRIBE_VAULT_NAME]
    );
    return String(result.rows[0]?.decrypted_secret || "").trim();
  } catch {
    return "";
  }
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
  if (!response.ok) throw new Error(`Resend video send failed (${response.status}): ${String(data.message || "unknown error")}`);
  const id = String(data.id || "");
  if (!id) throw new Error("Resend accepted the video email without returning an id.");
  return id;
}

function videoMessageBody(input: { contactName?: string | null; companyName?: string | null }, walkthroughUrl: string) {
  const firstName = String(input.contactName || "there").trim().split(/\s+/)[0] || "there";
  const company = String(input.companyName || "your business").trim() || "your business";
  return `Hi ${firstName},\n\nAbsolutely — here’s the 90-second ArborLine video I mentioned:\n\n${walkthroughUrl}\n\nIt gives a quick look at how ArborLine can help a recurring-service business like ${company} find matching companies, identify decision-makers, qualify opportunities, and keep interested replies organized.\n\nIf anything stands out or you have a question after watching it, just reply here.\n\nBest,\nJosh Thomas\nFounder, ArborLine Connect`;
}

async function verifiedProspect(input: { clientId: string; prospectId: string; recipientEmail: string }) {
  const prospect = await getPool().query(
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
  return person && person.suppression_status === "CLEAR" && !person.is_suppressed ? person : null;
}

export async function walkthroughAutomationConfigured() {
  // Video replies are intentionally review-first. The reply worker never auto-sends them.
  return false;
}

export async function prepareRequestedConnectVideoDraft(input: {
  replyId: string;
  clientId: string;
  prospectId: string;
  recipientEmail: string;
  contactName?: string | null;
  companyName?: string | null;
}) {
  const cfg = config();
  if (!cfg.validWalkthroughUrl) {
    return { prepared: false, alreadyPrepared: false, alreadySent: false, blocked: true, reason: "A valid HTTPS video URL is not configured." };
  }

  const videoAvailable = await connectWalkthroughVideoAvailable();
  if (!videoAvailable) {
    return { prepared: false, alreadyPrepared: false, alreadySent: false, blocked: true, reason: "The approved ArborLine 90-second video is not available yet." };
  }

  const person = await verifiedProspect(input);
  if (!person) {
    return { prepared: false, alreadyPrepared: false, alreadySent: false, blocked: true, reason: "Prospect is suppressed or no longer matches the verified recipient." };
  }

  const pool = getPool();
  const existing = await pool.query(
    `SELECT id,status,provider_message_id,subject,body_text
     FROM connect_outreach_messages
     WHERE prospect_id=$1 AND client_id=$2 AND lower(recipient_email)=lower($3)
       AND subject IN ($4,$5) AND status IN ('DRAFT','QUEUED','SENT','DELIVERED')
     ORDER BY created_at DESC LIMIT 1`,
    [input.prospectId, input.clientId, input.recipientEmail, CONNECT_VIDEO_SUBJECT, LEGACY_WALKTHROUGH_SUBJECT]
  );
  const current = existing.rows[0] ?? null;
  if (current?.status === "SENT" || current?.status === "DELIVERED") {
    return {
      prepared: false,
      alreadyPrepared: false,
      alreadySent: true,
      blocked: false,
      messageId: current.id,
      providerMessageId: current.provider_message_id || null,
      status: current.status
    };
  }

  const body = videoMessageBody(input, cfg.walkthroughUrl);
  if (current) {
    const updated = await pool.query(
      `UPDATE connect_outreach_messages
       SET subject=$2,body_text=$3,sender_name='Josh Thomas',sender_email=$4,error_message=NULL,updated_at=now()
       WHERE id=$1 AND status IN ('DRAFT','QUEUED')
       RETURNING id,status,subject,body_text,recipient_email`,
      [current.id, CONNECT_VIDEO_SUBJECT, body, CONNECT_FROM_EMAIL]
    );
    const message = updated.rows[0] ?? current;
    return {
      prepared: true,
      alreadyPrepared: true,
      alreadySent: false,
      blocked: false,
      messageId: message.id,
      status: message.status,
      subject: CONNECT_VIDEO_SUBJECT,
      body
    };
  }

  const inserted = await pool.query(
    `INSERT INTO connect_outreach_messages
      (prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status)
     VALUES ($1,$2,'Josh Thomas',$3,$4,$5,$6,'DRAFT')
     RETURNING id,status,subject,body_text,recipient_email`,
    [input.prospectId, input.clientId, CONNECT_FROM_EMAIL, input.recipientEmail, CONNECT_VIDEO_SUBJECT, body]
  );
  const message = inserted.rows[0];
  return {
    prepared: true,
    alreadyPrepared: false,
    alreadySent: false,
    blocked: false,
    messageId: message.id,
    status: message.status,
    subject: message.subject,
    body: message.body_text,
    replyId: input.replyId
  };
}

export async function sendRequestedConnectWalkthrough(input: {
  replyId: string;
  clientId: string;
  prospectId: string;
  recipientEmail: string;
  contactName?: string | null;
  companyName?: string | null;
  manual?: boolean;
}) {
  if (input.manual !== true) {
    return {
      sent: false,
      alreadySent: false,
      blocked: true,
      reason: "Explicit staff approval is required before sending the 90-second video."
    };
  }

  const prepared = await prepareRequestedConnectVideoDraft(input);
  if (prepared.alreadySent) {
    return { sent: false, alreadySent: true, blocked: false, providerMessageId: prepared.providerMessageId || null };
  }
  if (!prepared.prepared || prepared.blocked || !prepared.messageId) {
    return { sent: false, alreadySent: false, blocked: true, reason: prepared.reason || "Video response draft is not ready." };
  }

  const cfg = config();
  const unsubscribeSecret = await getUnsubscribeSecret();
  const ready = cfg.sendReadyBase && Boolean(unsubscribeSecret);
  if (!ready) {
    const missing = [
      !cfg.validWalkthroughUrl ? "valid HTTPS video URL" : null,
      !cfg.postalAddress ? "CONNECT_BUSINESS_POSTAL_ADDRESS" : null,
      !unsubscribeSecret ? "unsubscribe signing secret" : null
    ].filter(Boolean).join(", ");
    return {
      sent: false,
      alreadySent: false,
      blocked: true,
      reason: `Video send is not fully configured${missing ? `: ${missing}` : "."}`
    };
  }

  const pool = getPool();
  const claim = await pool.query(
    `UPDATE connect_outreach_messages
     SET status='QUEUED',error_message=NULL,updated_at=now()
     WHERE id=$1 AND status='DRAFT'
     RETURNING id,body_text,recipient_email`,
    [prepared.messageId]
  );
  if (!claim.rows[0]) {
    const existing = await pool.query(
      `SELECT status,provider_message_id FROM connect_outreach_messages WHERE id=$1 LIMIT 1`,
      [prepared.messageId]
    );
    if (["SENT", "DELIVERED"].includes(String(existing.rows[0]?.status))) {
      return { sent: false, alreadySent: true, blocked: false, providerMessageId: existing.rows[0]?.provider_message_id || null };
    }
    return { sent: false, alreadySent: false, blocked: true, reason: "The video response is already being processed or is no longer a reviewable draft." };
  }

  const message = claim.rows[0];
  const token = unsubscribeToken(String(message.id), unsubscribeSecret);
  const unsubscribeUrl = `${baseUrl()}/api/public/connect-unsubscribe/${token}`;
  const text = `${message.body_text}\n\nArborLine Connect\n${cfg.postalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
  const htmlBody = escapeHtml(String(message.body_text)).replace(/\n/g, "<br />");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#122033;line-height:1.6">${htmlBody}<hr style="border:0;border-top:1px solid #dbe3ee;margin:28px 0 16px"/><div style="font-size:12px;color:#637083">ArborLine Connect<br/>${escapeHtml(cfg.postalAddress)}<br/><a href="${unsubscribeUrl}">Unsubscribe</a></div></div>`;

  try {
    const providerId = await resend(
      {
        from: CONNECT_FROM,
        reply_to: CONNECT_REPLY_TO,
        to: [message.recipient_email],
        subject: CONNECT_VIDEO_SUBJECT,
        text,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
        }
      },
      `connect-video-${message.id}`
    );

    await pool.query(
      `UPDATE connect_outreach_messages
       SET provider_message_id=$2,status='SENT',sent_at=coalesce(sent_at,now()),sender_name='Josh Thomas',sender_email=$3,updated_at=now()
       WHERE id=$1 AND status='QUEUED'`,
      [message.id, providerId, CONNECT_FROM_EMAIL]
    );

    return { sent: true, alreadySent: false, blocked: false, providerMessageId: providerId, replyId: input.replyId };
  } catch (error) {
    await pool.query(
      `UPDATE connect_outreach_messages
       SET status='DRAFT',error_message=$2,updated_at=now()
       WHERE id=$1 AND status='QUEUED'`,
      [message.id, error instanceof Error ? error.message.slice(0, 1000) : "Video send failed"]
    ).catch(() => undefined);
    throw error;
  }
}
