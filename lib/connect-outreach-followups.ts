import { randomUUID } from "crypto";
import { getPool } from "@/lib/db";

export const CONNECT_FOLLOW_UP_EXPERIMENT_KEY = "alc_follow_up_v1";
export const CONNECT_FOLLOW_UP_VARIANT = "CONTROL";

const INHERITABLE_APPROVAL_SOURCES = [
  "STAFF_SINGLE",
  "STAFF_BATCH_CONFIRMED",
  "LEGACY_USER_CONFIRMED"
] as const;

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
              m.sent_at,
              m.approved_at,
              m.approved_by_user_id,
              m.approval_source
       FROM connect_outreach_messages m
       JOIN connect_clients c ON c.id=m.client_id
       WHERE lower(c.company_name)=lower('ArborLine Connect')
         AND m.status IN ('SENT','DELIVERED')
         AND m.sent_at IS NOT NULL
         AND m.approved_at IS NOT NULL
         AND m.approved_by_user_id IS NOT NULL
         AND m.approval_source = ANY($3::text[])
         AND coalesce(m.experiment_key,'') <> $1
       ORDER BY m.prospect_id,m.sent_at DESC,m.id DESC
     )
     SELECT p.*,
            ft.original_message_id,
            ft.sent_at AS original_sent_at,
            ft.approved_at AS original_approved_at,
            ft.approved_by_user_id AS original_approved_by_user_id,
            ft.approval_source AS original_approval_source
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
    [CONNECT_FOLLOW_UP_EXPERIMENT_KEY, safeLimit, [...INHERITABLE_APPROVAL_SOURCES]]
  );

  let draftsCreated = 0;
  let approvalsInherited = 0;
  let messagesQueued = 0;
  const createdIds: string[] = [];

  for (const prospect of rows) {
    const messageId = randomUUID();
    const draft = buildConnectFollowUpDraft(prospect);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO connect_outreach_messages
           (id,prospect_id,client_id,sender_name,sender_email,recipient_email,
            subject,body_text,status,experiment_key,experiment_variant,
            approved_at,approved_by_user_id,approval_source)
         SELECT $1,p.id,p.client_id,'Josh Thomas','josh@mail.arborlineconnect.com',$4,
                $5,$6,'QUEUED',$7,$8,$9,$10,$11
         FROM connect_prospects p
         WHERE p.id=$2
           AND p.client_id=$3
           AND p.outreach_status='CONTACTED'
           AND p.qualification_status='QUALIFIED'
           AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
           AND p.suppression_status='CLEAR'
           AND p.contact_name IS NOT NULL
           AND public.connect_contact_name_is_personlike(p.contact_name)
           AND p.contact_email IS NOT NULL
           AND lower(p.contact_email)=lower($4)
           AND public.connect_contact_is_verified(p)
           AND $9::timestamptz IS NOT NULL
           AND $10::uuid IS NOT NULL
           AND $11::text = ANY($12::text[])
           AND NOT EXISTS (
             SELECT 1 FROM connect_outreach_messages existing
             WHERE existing.prospect_id=p.id
               AND existing.experiment_key=$7
               AND existing.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_replies r WHERE r.prospect_id=p.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_suppressions s
             WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
               AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
                 OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
           )
         RETURNING id,prospect_id`,
        [
          messageId,
          prospect.id,
          prospect.client_id,
          prospect.contact_email,
          draft.subject,
          draft.body,
          CONNECT_FOLLOW_UP_EXPERIMENT_KEY,
          CONNECT_FOLLOW_UP_VARIANT,
          prospect.original_approved_at,
          prospect.original_approved_by_user_id,
          prospect.original_approval_source,
          [...INHERITABLE_APPROVAL_SOURCES]
        ]
      );

      const insertedMessage = inserted.rows[0];
      if (!insertedMessage?.id) {
        await client.query("COMMIT");
        continue;
      }

      const queuedProspect = await client.query(
        `UPDATE connect_prospects
         SET outreach_status='QUEUED',updated_at=now()
         WHERE id=$1 AND outreach_status='CONTACTED'
         RETURNING id`,
        [insertedMessage.prospect_id]
      );
      if (!queuedProspect.rows[0]?.id) {
        throw new Error("Follow-up approval inheritance could not queue the prospect safely.");
      }

      await client.query("COMMIT");
      draftsCreated++;
      approvalsInherited++;
      messagesQueued++;
      createdIds.push(String(insertedMessage.id));
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    eligible: rows.length,
    draftsCreated,
    createdIds,
    approvalsCreated: 0,
    approvalsInherited,
    messagesQueued,
    messagesSent: 0,
    experimentKey: CONNECT_FOLLOW_UP_EXPERIMENT_KEY,
    minimumBusinessDays: 2
  };
}
