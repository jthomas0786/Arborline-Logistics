import { createHash, randomUUID } from "crypto";
import { getPool } from "@/lib/db";
import { connectSamplesViewUrl } from "@/lib/connect-outreach-tracking";

const CONNECT_FROM_EMAIL = "josh@mail.arborlineconnect.com";
export const CONNECT_SAMPLES_EXPERIMENT_KEY = "alc_samples_link_v2";
export type ConnectSamplesExperimentVariant = "CONTROL" | "SAMPLES_LINK";

function sentence(value: string) { const clean = value.trim(); return /[.!?]$/.test(clean) ? clean : `${clean}.`; }
function questionName(value: string) { return value.trim().replace(/[.!?]+$/, ""); }

function isArborLineOwnOutreach(prospect: Record<string, unknown>) {
  return String(prospect.client_company || "").trim().toLowerCase() === "arborline connect";
}

export function connectSamplesExperimentVariant(prospect: Record<string, unknown>): ConnectSamplesExperimentVariant | null {
  if (!isArborLineOwnOutreach(prospect)) return null;
  const stableId = String(prospect.id || prospect.prospect_id || prospect.contact_email || prospect.company_name || "").trim().toLowerCase();
  const bucket = createHash("sha256").update(`${CONNECT_SAMPLES_EXPERIMENT_KEY}:${stableId}`).digest()[0];
  return bucket % 2 === 0 ? "CONTROL" : "SAMPLES_LINK";
}

export function buildConnectOutreachDraft(prospect: Record<string, unknown>, options: { samplesUrl?: string } = {}) {
  const contactName = String(prospect.contact_name || "there");
  const firstName = contactName.split(/\s+/)[0];
  const company = String(prospect.company_name || "your company").trim();
  const companyQuestion = questionName(company) || "your company";
  const title = String(prospect.contact_title || "").trim();
  const client = String(prospect.client_company || "our client");
  if (client.toLowerCase() === "arborline connect") {
    const roleLine = title ? `I saw you’re the ${title} at ${sentence(company)}` : `I came across ${sentence(company)}`;
    const samplesLine = options.samplesUrl
      ? `\n\nIf you’d rather see an example now, here’s a free 3–5 company sample:\n${options.samplesUrl}`
      : "";
    return {
      subject: `quick question about ${company}`,
      body: `Hi ${firstName},\n\nI’m Josh, founder of ArborLine Connect. ${roleLine}\n\nWe help service companies find businesses that fit their ideal customer profile and the right decision-makers to contact—without spending hours building lists.\n\nWant me to send you 3–5 companies that look like they could fit ${companyQuestion}?${samplesLine}\n\nIf they’re useful, I can show you how we keep finding more each week.\n\nIf it’s not relevant, just say so and I’ll stop.\n\nBest,\nJosh\nArborLine Connect`
    };
  }
  const serviceLine = prospect.service_summary ? String(prospect.service_summary).replace(/\s+/g, " ").slice(0, 260) : `services from ${client}`;
  const booking = String(prospect.booking_type || "CALL").toLowerCase();
  const roleContext = title ? `Given your role as ${title} at ${sentence(company)} I thought this might be relevant.` : `${sentence(company)} It looks like it may be a fit.`;
  return { subject: `${company} facilities — quick question`, body: `Hi ${firstName},\n\nI’m Josh Thomas with ArborLine Connect, reaching out on behalf of ${sentence(client)} ${roleContext}\n\n${client} provides ${sentence(serviceLine)}\n\nWould you be open to a quick ${booking} to see whether it makes sense to talk?\n\nIf this isn’t relevant or you’d rather not hear from me, just reply “no thanks” and I’ll stop.\n\nBest,\nJosh Thomas\nArborLine Connect` };
}

export function buildConnectOutreachDraftForMessage(prospect: Record<string, unknown>, messageId: string) {
  const assignedVariant = connectSamplesExperimentVariant(prospect);
  const samplesUrl = assignedVariant === "SAMPLES_LINK" ? connectSamplesViewUrl(messageId) : "";
  const experimentVariant: ConnectSamplesExperimentVariant | null = assignedVariant === "SAMPLES_LINK" && !samplesUrl
    ? "CONTROL"
    : assignedVariant;
  const draft = buildConnectOutreachDraft(prospect, { samplesUrl: experimentVariant === "SAMPLES_LINK" ? samplesUrl : "" });
  return {
    ...draft,
    experimentKey: experimentVariant ? CONNECT_SAMPLES_EXPERIMENT_KEY : null,
    experimentVariant
  };
}


export async function prepareConnectPreVerificationDrafts(clientId: string, limit = 50, segmentId?: string | null) {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { rows } = await pool.query(
    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type
     FROM connect_prospects p
     JOIN connect_clients c ON c.id=p.client_id
     WHERE p.client_id=$1
       AND (($3::uuid IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='NOT_READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_title IS NOT NULL
       AND p.domain IS NOT NULL
       AND NOT public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages m
         WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_prepared_outreach_drafts pd
         WHERE pd.prospect_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND (
             (p.contact_email IS NOT NULL AND s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain))
           )
       )
     ORDER BY p.qualification_score DESC,p.updated_at DESC
     LIMIT $2`,
    [clientId, safeLimit, segmentId ?? null]
  );

  let prepared = 0;
  for (const prospect of rows) {
    const preparedId = randomUUID();
    const { subject, body, experimentKey, experimentVariant } = buildConnectOutreachDraftForMessage(prospect, preparedId);
    const result = await pool.query(
      `INSERT INTO connect_prepared_outreach_drafts
         (id,prospect_id,client_id,subject,body_text,experiment_key,experiment_variant,
          contact_name_snapshot,contact_title_snapshot,qualification_score_snapshot,status,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PREPARED',$11::jsonb)
       ON CONFLICT (prospect_id) DO NOTHING
       RETURNING id`,
      [
        preparedId,
        prospect.id,
        prospect.client_id,
        subject,
        body,
        experimentKey,
        experimentVariant,
        prospect.contact_name,
        prospect.contact_title,
        prospect.qualification_score,
        JSON.stringify({
          review_only: true,
          contact_verification_pending: true,
          prepared_reason: "QUALIFIED_SERVICE_FIT_MATCH_DECISION_MAKER",
          prepared_at: new Date().toISOString()
        })
      ]
    );
    prepared += result.rowCount ?? 0;
  }

  return {
    segmentId: segmentId ?? null,
    eligible: rows.length,
    preparedDraftsCreated: prepared,
    messagesCreated: 0,
    approvalsCreated: 0,
    messagesSent: 0
  };
}

export async function promotePreparedOutreachDrafts(clientId: string, limit = 50, segmentId?: string | null) {
  const pool = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const { rows } = await pool.query(
    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type,
            pd.id AS prepared_draft_id
     FROM connect_prepared_outreach_drafts pd
     JOIN connect_prospects p ON p.id=pd.prospect_id
     JOIN connect_clients c ON c.id=p.client_id
     WHERE pd.client_id=$1
       AND pd.status='PREPARED'
       AND (($3::uuid IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_email IS NOT NULL
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages m
         WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     ORDER BY pd.prepared_at ASC
     LIMIT $2`,
    [clientId, safeLimit, segmentId ?? null]
  );

  let promoted = 0;
  for (const prospect of rows) {
    const preparedId = String(prospect.prepared_draft_id);
    const { subject, body, experimentKey, experimentVariant } = buildConnectOutreachDraftForMessage(prospect, preparedId);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const inserted = await db.query(
        `INSERT INTO connect_outreach_messages
           (id,prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status,experiment_key,experiment_variant)
         SELECT $1,$2,$3,'Josh Thomas',$4,$5,$6,$7,'DRAFT',$8,$9
         WHERE NOT EXISTS (
           SELECT 1 FROM connect_suppressions s
           WHERE (s.client_id IS NULL OR s.client_id=$3)
             AND ((s.email IS NOT NULL AND lower(s.email)=lower($5))
               OR (s.domain IS NOT NULL AND lower(s.domain)=lower($10)))
         )
           AND NOT EXISTS (
             SELECT 1 FROM connect_outreach_messages m
             WHERE m.prospect_id=$2 AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
           )
         RETURNING id`,
        [
          preparedId,
          prospect.id,
          prospect.client_id,
          CONNECT_FROM_EMAIL,
          prospect.contact_email,
          subject,
          body,
          experimentKey,
          experimentVariant,
          prospect.domain
        ]
      );
      if (inserted.rows[0]) {
        await db.query(
          `UPDATE connect_prepared_outreach_drafts
           SET status='PROMOTED',subject=$2,body_text=$3,experiment_key=$4,experiment_variant=$5,
               promoted_at=now(),updated_at=now(),
               metadata=coalesce(metadata,'{}'::jsonb) || $6::jsonb
           WHERE id=$1 AND status='PREPARED'`,
          [
            preparedId,
            subject,
            body,
            experimentKey,
            experimentVariant,
            JSON.stringify({
              contact_verification_pending: false,
              promoted_to_outreach_message: true,
              promoted_at: new Date().toISOString(),
              recipient_email: prospect.contact_email
            })
          ]
        );
        promoted++;
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  }

  return {
    segmentId: segmentId ?? null,
    eligible: rows.length,
    preparedDraftsPromoted: promoted,
    draftsCreated: promoted,
    approvalsCreated: 0,
    messagesSent: 0
  };
}

async function eligibleProspects(clientId: string, limit: number, segmentId?: string | null) {
  return getPool().query(
    `SELECT p.*,c.company_name AS client_company,c.service_summary,c.booking_type
     FROM connect_prospects p
     JOIN connect_clients c ON c.id=p.client_id
     WHERE p.client_id=$1
       AND (($3::uuid IS NULL AND p.segment_id IS NULL) OR p.segment_id=$3)
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_name IS NOT NULL
       AND public.connect_contact_name_is_personlike(p.contact_name)
       AND p.contact_email IS NOT NULL
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_outreach_messages m
         WHERE m.prospect_id=p.id AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')
       )
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     ORDER BY p.qualification_score DESC,p.updated_at DESC
     LIMIT $2`,
    [clientId, Math.max(1, Math.min(limit, 50)), segmentId ?? null]
  );
}

export async function previewConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {
  const { rows } = await eligibleProspects(clientId, limit, segmentId);
  return { dryRun: true, segmentId: segmentId ?? null, eligible: rows.length, limit: Math.max(1, Math.min(limit, 50)), draftsCreated: 0, messagesSent: 0 };
}

export async function prepareConnectOutreachDrafts(clientId: string, limit = 25, segmentId?: string | null) {
  const promoted = await promotePreparedOutreachDrafts(clientId, limit, segmentId);
  const pool = getPool(); const { rows } = await eligibleProspects(clientId, limit, segmentId); let generated = promoted.draftsCreated;
  for (const prospect of rows) {
    const messageId = randomUUID();
    const { subject, body, experimentKey, experimentVariant } = buildConnectOutreachDraftForMessage(prospect, messageId);
    const result = await pool.query(`INSERT INTO connect_outreach_messages (id,prospect_id,client_id,sender_name,sender_email,recipient_email,subject,body_text,status,experiment_key,experiment_variant) SELECT $1,$2,$3,'Josh Thomas',$4,$5,$6,$7,'DRAFT',$8,$9 WHERE NOT EXISTS (SELECT 1 FROM connect_suppressions s WHERE (s.client_id IS NULL OR s.client_id=$3) AND ((s.email IS NOT NULL AND lower(s.email)=lower($5)) OR (s.domain IS NOT NULL AND lower(s.domain)=lower($10))) ) AND NOT EXISTS (SELECT 1 FROM connect_outreach_messages m WHERE m.prospect_id=$2 AND m.status IN ('DRAFT','QUEUED','SENT','DELIVERED')) RETURNING id`, [messageId, prospect.id, prospect.client_id, CONNECT_FROM_EMAIL, prospect.contact_email, subject, body, experimentKey, experimentVariant, prospect.domain]);
    generated += result.rowCount ?? 0;
  }
  return {
    segmentId: segmentId ?? null,
    eligible: rows.length + promoted.eligible,
    preparedDraftsPromoted: promoted.preparedDraftsPromoted,
    draftsCreated: generated,
    messagesSent: 0
  };
}
