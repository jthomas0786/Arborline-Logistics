import { getPool } from "@/lib/db";
import { sendRequestedConnectWalkthrough } from "@/lib/connect-walkthrough";

export type ConnectReplyClassification =
  | "INTERESTED"
  | "VIDEO_REQUESTED"
  | "OBJECTION"
  | "NOT_NOW"
  | "WRONG_CONTACT"
  | "UNSUBSCRIBE"
  | "OUT_OF_OFFICE"
  | "UNKNOWN";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
}

function plainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function retrieveResendReceivedEmail(emailId: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Unable to retrieve received email (${response.status}).`);
  return {
    from: normalizeEmail(String(data.from ?? "")),
    to: Array.isArray(data.to) ? data.to.map(String) : [],
    subject: String(data.subject ?? ""),
    text: String(data.text ?? "").trim() || plainText(String(data.html ?? "")),
    messageId: String(data.message_id ?? ""),
    headers: data.headers && typeof data.headers === "object" ? data.headers as Record<string, unknown> : {},
  };
}

export async function recordConnectInboundReply(input: {
  providerEmailId: string;
  fromEmail: string;
  toEmails: string[];
  subject?: string | null;
  bodyText?: string | null;
  providerMessageId?: string | null;
  rawPayload?: Record<string, unknown>;
  receivedAt?: string | Date | null;
}) {
  const pool = getPool();
  const providerEmailId = input.providerEmailId.trim();
  const fromEmail = normalizeEmail(input.fromEmail);
  if (!providerEmailId || !fromEmail) throw new Error("Inbound reply requires provider email id and sender.");

  const existing = await pool.query(
    `SELECT id,client_id,prospect_id,match_status,classification_status
     FROM connect_replies WHERE provider='RESEND' AND provider_email_id=$1 LIMIT 1`,
    [providerEmailId]
  );
  if (existing.rows[0]) return { ...existing.rows[0], created: false };

  const matched = await pool.query(
    `SELECT m.id AS outreach_message_id,m.client_id,m.prospect_id
     FROM connect_outreach_messages m
     WHERE lower(m.recipient_email)=lower($1)
       AND m.status IN ('SENT','DELIVERED')
       AND COALESCE(m.sent_at,m.created_at) >= now() - interval '180 days'
     ORDER BY COALESCE(m.sent_at,m.created_at) DESC
     LIMIT 1`,
    [fromEmail]
  );
  const link = matched.rows[0] ?? null;
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();

  const inserted = await pool.query(
    `INSERT INTO connect_replies
      (client_id,prospect_id,outreach_message_id,provider,provider_email_id,provider_message_id,
       from_email,to_emails,subject,body_text,match_status,raw_payload,received_at)
     VALUES ($1,$2,$3,'RESEND',$4,$5,$6,$7::text[],$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (provider,provider_email_id) DO NOTHING
     RETURNING id,client_id,prospect_id,match_status,classification_status`,
    [
      link?.client_id ?? null,
      link?.prospect_id ?? null,
      link?.outreach_message_id ?? null,
      providerEmailId,
      input.providerMessageId || null,
      fromEmail,
      input.toEmails.map(normalizeEmail).filter(Boolean),
      input.subject || null,
      input.bodyText || null,
      link ? "MATCHED" : "UNMATCHED",
      JSON.stringify(input.rawPayload ?? {}),
      receivedAt
    ]
  );

  if (link?.prospect_id) {
    await pool.query(
      `UPDATE connect_prospects
       SET outreach_status=CASE WHEN outreach_status='STOPPED' THEN outreach_status ELSE 'REPLIED' END,updated_at=now()
       WHERE id=$1`,
      [link.prospect_id]
    );
  }

  return { ...(inserted.rows[0] ?? {}), created: Boolean(inserted.rows[0]) };
}

function offeredWalkthrough(originalBody: string | null | undefined) {
  const value = String(originalBody || "").toLowerCase();
  return /2[- ]minute walkthrough/.test(value) && value.includes("arborline");
}

export function classifyConnectReply(
  subject: string | null | undefined,
  body: string | null | undefined,
  originalBody?: string | null
) {
  const value = `${subject ?? ""}\n${body ?? ""}`.toLowerCase().replace(/[’]/g, "'");
  const has = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

  if (has([/\bunsubscribe\b/, /\bremove me\b/, /\bstop emailing\b/, /\bstop contacting\b/, /\bdo not contact\b/, /\bdon't contact\b/, /\bno thanks\b/])) {
    return { classification: "UNSUBSCRIBE" as const, confidence: 99, reasons: ["Explicit opt-out language detected."] };
  }
  if (has([/out of office/, /automatic reply/, /auto[- ]?reply/, /away from (the )?office/, /i am away/, /i'm away/])) {
    return { classification: "OUT_OF_OFFICE" as const, confidence: 96, reasons: ["Automatic or out-of-office language detected."] };
  }
  if (has([/wrong (person|contact)/, /not the right (person|contact)/, /you have the wrong/, /i don't handle/, /i do not handle/])) {
    return { classification: "WRONG_CONTACT" as const, confidence: 94, reasons: ["Sender indicated they are not the correct contact."] };
  }
  if (has([/not (right )?now/, /circle back/, /reach out (again )?(in|next)/, /follow up (again )?(in|next)/, /next quarter/, /later this (month|year)/])) {
    return { classification: "NOT_NOW" as const, confidence: 90, reasons: ["Reply asks to revisit at a later time."] };
  }
  if (has([/not interested/, /not a fit/, /no need/, /already (have|using|use)/, /too expensive/, /not looking/])) {
    return { classification: "OBJECTION" as const, confidence: 92, reasons: ["Negative fit or objection language detected."] };
  }
  if (offeredWalkthrough(originalBody) && has([
    /^\s*(yes|yes please|sure|absolutely|please do|sounds good|that works|send it)\b/m,
    /\bsend (it|me (the )?(video|walkthrough|overview)|the (video|walkthrough|overview))\b/,
    /\b(i'd|i would) (like|love) (to see|that|the (video|walkthrough|overview))\b/,
    /\b(video|walkthrough|overview)\b.{0,40}\b(please|yes|sure|send)\b/
  ])) {
    return { classification: "VIDEO_REQUESTED" as const, confidence: 98, reasons: ["Prospect explicitly accepted the offered 2-minute walkthrough."] };
  }
  if (has([/\binterested\b/, /let's talk/, /lets talk/, /\bschedule\b/, /\bcalendar\b/, /tell me more/, /learn more/, /sounds good/, /call me/, /send (me )?more/, /^\s*yes\b/m])) {
    return { classification: "INTERESTED" as const, confidence: 91, reasons: ["Positive interest or scheduling language detected."] };
  }
  return { classification: "UNKNOWN" as const, confidence: 40, reasons: ["No high-confidence classification rule matched."] };
}

export async function previewPendingConnectReplies(clientId: string, limit = 25) {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS eligible
     FROM connect_replies
     WHERE client_id=$1 AND match_status='MATCHED' AND classification_status='PENDING'`,
    [clientId]
  );
  return { dryRun: true, eligible: rows[0]?.eligible ?? 0, limit, recordsChanged: false };
}

export async function classifyPendingConnectReplies(clientId: string, limit = 25) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT r.id,r.client_id,r.prospect_id,r.from_email,r.subject,r.body_text,
            m.subject AS original_subject,m.body_text AS original_body,
            p.contact_name,p.company_name
     FROM connect_replies r
     LEFT JOIN connect_outreach_messages m ON m.id=r.outreach_message_id
     LEFT JOIN connect_prospects p ON p.id=r.prospect_id
     WHERE r.client_id=$1 AND r.match_status='MATCHED' AND r.classification_status='PENDING'
     ORDER BY r.received_at ASC LIMIT $2`,
    [clientId, Math.max(1, Math.min(limit, 50))]
  );

  const result = {
    classified: 0,
    interested: [] as string[],
    walkthroughsSent: 0,
    walkthroughsAlreadySent: 0,
    walkthroughsBlocked: 0,
    unsubscribed: 0,
    needsReview: 0
  };

  for (const row of rows) {
    const classification = classifyConnectReply(row.subject, row.body_text, row.original_body);
    let status = classification.classification === "UNKNOWN" ? "NEEDS_REVIEW" : "CLASSIFIED";
    const reasons = [...classification.reasons];

    if (classification.classification === "VIDEO_REQUESTED") {
      if (!row.prospect_id || !row.client_id) {
        status = "NEEDS_REVIEW";
        reasons.push("Matched reply is missing a prospect or client link, so the walkthrough was not sent.");
        result.walkthroughsBlocked++;
        result.needsReview++;
      } else {
        const delivery = await sendRequestedConnectWalkthrough({
          replyId: row.id,
          clientId: row.client_id,
          prospectId: row.prospect_id,
          recipientEmail: row.from_email,
          contactName: row.contact_name,
          companyName: row.company_name
        });
        if (delivery.sent) {
          reasons.push("Requested walkthrough was sent automatically through the reply worker.");
          result.walkthroughsSent++;
        } else if (delivery.alreadySent) {
          reasons.push("Requested walkthrough had already been sent; duplicate delivery was prevented.");
          result.walkthroughsAlreadySent++;
        } else {
          status = "NEEDS_REVIEW";
          reasons.push(delivery.reason || "Requested walkthrough could not be sent automatically.");
          result.walkthroughsBlocked++;
          result.needsReview++;
        }
      }
    }

    await pool.query(
      `UPDATE connect_replies
       SET classification_status=$2,classification=$3,classification_confidence=$4,
           classification_reasons=$5::jsonb,classified_at=now(),updated_at=now()
       WHERE id=$1 AND classification_status='PENDING'`,
      [row.id, status, classification.classification, classification.confidence, JSON.stringify(reasons)]
    );
    result.classified++;

    if (classification.classification === "UNSUBSCRIBE") {
      await pool.query(
        `INSERT INTO connect_suppressions (client_id,email,reason,source)
         VALUES (NULL,$1,'UNSUBSCRIBED','REPLY_WORKER')
         ON CONFLICT DO NOTHING`,
        [row.from_email]
      );
      if (row.prospect_id) {
        await pool.query(
          `UPDATE connect_prospects
           SET suppression_status='UNSUBSCRIBED',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now()
           WHERE id=$1`,
          [row.prospect_id]
        );
      }
      result.unsubscribed++;
    } else if (classification.classification === "INTERESTED") {
      if (row.prospect_id) {
        await pool.query(
          `UPDATE connect_prospects SET outreach_status='REPLIED',updated_at=now()
           WHERE id=$1 AND outreach_status<>'STOPPED'`,
          [row.prospect_id]
        );
      }
      result.interested.push(row.id);
    } else if (classification.classification === "VIDEO_REQUESTED") {
      if (row.prospect_id) {
        await pool.query(
          `UPDATE connect_prospects SET outreach_status='REPLIED',updated_at=now()
           WHERE id=$1 AND outreach_status<>'STOPPED'`,
          [row.prospect_id]
        );
      }
    } else if (classification.classification === "UNKNOWN") {
      result.needsReview++;
    }
  }
  return result;
}

export async function previewConnectHandoffs(clientId: string, replyId?: string | null) {
  const params: unknown[] = [clientId];
  let replyClause = "";
  if (replyId) {
    params.push(replyId);
    replyClause = " AND r.id=$2";
  }
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS eligible
     FROM connect_replies r
     WHERE r.client_id=$1 AND r.classification='INTERESTED'${replyClause}
       AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.reply_id=r.id)`,
    params
  );
  return { dryRun: true, eligible: rows[0]?.eligible ?? 0, recordsChanged: false };
}

export async function createConnectHandoffs(clientId: string, limit = 25, replyId?: string | null) {
  const pool = getPool();
  const params: unknown[] = [clientId];
  let replyClause = "";
  if (replyId) {
    params.push(replyId);
    replyClause = " AND r.id=$2";
  }
  params.push(Math.max(1, Math.min(limit, 50)));
  const limitParam = params.length;
  const { rows } = await pool.query(
    `SELECT r.id AS reply_id,r.prospect_id,r.from_email,r.body_text,
            p.contact_name,p.company_name,c.booking_type
     FROM connect_replies r
     JOIN connect_prospects p ON p.id=r.prospect_id
     JOIN connect_clients c ON c.id=r.client_id
     WHERE r.client_id=$1 AND r.classification='INTERESTED'${replyClause}
       AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.reply_id=r.id)
     ORDER BY r.received_at ASC LIMIT $${limitParam}`,
    params
  );

  let created = 0;
  for (const row of rows) {
    const excerpt = String(row.body_text || "Interested reply received.").replace(/\s+/g, " ").trim().slice(0, 500);
    const summary = `${row.contact_name || row.from_email} at ${row.company_name} replied with interest. ${excerpt}`;
    const inserted = await pool.query(
      `INSERT INTO connect_handoffs
        (client_id,prospect_id,reply_id,status,booking_type,contact_name,contact_email,company_name,summary,suggested_next_step)
       VALUES ($1,$2,$3,'READY_FOR_REVIEW',$4,$5,$6,$7,$8,$9)
       ON CONFLICT (reply_id) DO NOTHING RETURNING id`,
      [clientId,row.prospect_id,row.reply_id,row.booking_type,row.contact_name,row.from_email,row.company_name,summary,`Review reply and arrange ${String(row.booking_type || "CALL").toLowerCase()}.`]
    );
    created += inserted.rowCount ?? 0;
  }
  return { eligible: rows.length, handoffsCreated: created, meetingsBooked: 0 };
}
