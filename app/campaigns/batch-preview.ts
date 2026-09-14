import { getPool } from "@/lib/db";

export const CAMPAIGN_STAGE_CAP = 5;

export async function previewDraftBatch(clientId: string, limit = CAMPAIGN_STAGE_CAP) {
  const safeLimit = Math.max(1, Math.min(CAMPAIGN_STAGE_CAP, Math.floor(limit || CAMPAIGN_STAGE_CAP)));
  const { rows } = await getPool().query(
    `SELECT m.id,m.client_id,m.subject,m.recipient_email,m.created_at,
            p.company_name,p.contact_name,p.contact_title,p.qualification_score
     FROM connect_outreach_messages m
     JOIN connect_prospects p ON p.id=m.prospect_id
     WHERE m.client_id=$1
       AND m.status='DRAFT'
       AND p.qualification_status='QUALIFIED'
       AND p.outreach_status='READY'
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NOT NULL
       AND lower(p.contact_email)=lower(m.recipient_email)
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
     ORDER BY p.qualification_score DESC NULLS LAST,m.created_at ASC,m.id ASC
     LIMIT $2`,
    [clientId, safeLimit]
  );
  return rows;
}
