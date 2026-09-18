import { randomUUID } from "crypto";
import { getPool } from "@/lib/db";

export const CONNECT_FOLLOW_UP_EXPERIMENT_KEY = "alc_follow_up_v1";
export const CONNECT_FOLLOW_UP_VARIANT = "CONTROL";

function firstName(value: unknown) {
  const clean = String(value || "there").trim();
  return clean.split(/\s+/)[0] || "there";
}

function companyName(value: unknown) {
  return String(value || "your company").trim() || "your company";
}

export function buildConnectFollowUpDraft(prospect: Record<string, unknown>) {
  const first = firstName(prospect.contact_name);
  const company = companyName(prospect.company_name);
  return {
    subject: `quick follow-up — ${company}`,
    body: `Hi ${first},\n\nQuick follow-up — would it be useful if I sent you 3–5 prospect companies that look like they could fit ${company}?\n\nNo call needed. I can just send the examples over.\n\nBest,\nJosh`
  };
}

export async function prepareDueConnectFollowUpDrafts(limit = 50) {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 50)));
  const { rows } = await pool.query(
    `WITH latest_first_touch AS (
       SELECT DISTINCT ON (m.prospect_id)
              m.id AS original_message_id,
              m.prospect_id,
              m.client_id,
              m.recipient_email,
              m.sent_at
       FROM connect_outreach_messages m
       JOIN connect_clients c ON c.id=m.client_id
       WHERE lower(c.company_name)=lower('ArborLine Connect')
         AND m.status IN ('SENT','DELIVERED')
         AND m.sent_at IS NOT NULL
         AND coalesce(m.experiment_key,'') <> $1
       ORDER BY m.prospect_id,m.sent_at DESC,m.id DESC
     )
     SELECT p.*,ft.original_message_id,ft.sent_at AS original_sent_at
     FROM latest_first_touch ft
     JOIN connect_prospects p ON p.id=ft.prospect_id
     WHERE p.outreach_status='CONTACTED'
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_email IS NOT NULL
       AND lower(p.contact_email)=lower(ft.recipient_email)
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_replies r
         WHERE r.prospect_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages follow_up
         WHERE follow_up.prospect_id=p.id
           AND follow_up.experiment_key=$1
           AND follow_up.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
       AND (
         SELECT count(*)
         FROM generate_series(
           ((ft.sent_at AT TIME ZONE 'America/Chicago')::date + 1),
           (now() AT TIME ZONE 'America/Chicago')::date,
           interval '1 day'
         ) AS business_day
         WHERE extract(isodow FROM business_day) BETWEEN 1 AND 5
       ) >= 2
     ORDER BY ft.sent_at ASC,p.qualification_score DESC NULLS LAST,p.id
     LIMIT $2`,
    [CONNECT_FOLLOW_UP_EXPERIMENT_KEY, safeLimit]
  );

  let draftsCreated = 0;
  const createdIds: string[] = [];
  for (const prospect of rows) {
    const messageId = randomUUID();
    const draft = buildConnectFollowUpDraft(prospect);
    const inserted = await pool.query(
      `INSERT INTO connect_outreach_messages
         (id,prospect_id,client_id,sender_name,sender_email,recipient_email,
          subject,body_text,status,experiment_key,experiment_variant)
       SELECT $1,$2,$3,'Josh Thomas','josh@mail.arborlineconnect.com',$4,
              $5,$6,'DRAFT',$7,$8
       WHERE NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages existing
         WHERE existing.prospect_id=$2
           AND existing.experiment_key=$7
           AND existing.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
         AND NOT EXISTS (
           SELECT 1 FROM connect_replies r WHERE r.prospect_id=$2
         )
         AND NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           JOIN connect_prospects p ON p.id=$2
           WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
         )
       RETURNING id`,
      [
        messageId,
        prospect.id,
        prospect.client_id,
        prospect.contact_email,
        draft.subject,
        draft.body,
        CONNECT_FOLLOW_UP_EXPERIMENT_KEY,
        CONNECT_FOLLOW_UP_VARIANT
      ]
    );
    if (inserted.rows[0]?.id) {
      draftsCreated++;
      createdIds.push(String(inserted.rows[0].id));
    }
  }

  return {
    eligible: rows.length,
    draftsCreated,
    createdIds,
    approvalsCreated: 0,
    messagesQueued: 0,
    messagesSent: 0,
    experimentKey: CONNECT_FOLLOW_UP_EXPERIMENT_KEY,
    minimumBusinessDays: 2
  };
}
