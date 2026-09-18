import { getPool } from "@/lib/db";
import { CONNECT_FOLLOW_UP_EXPERIMENT_KEY } from "@/lib/connect-outreach-followups";

export const CAMPAIGN_STAGE_CAP = 5;

export async function previewDraftBatch(clientId: string, limit = CAMPAIGN_STAGE_CAP) {
  const safeLimit = Math.max(1, Math.min(CAMPAIGN_STAGE_CAP, Math.floor(limit || CAMPAIGN_STAGE_CAP)));
  const { rows } = await getPool().query(
    `SELECT m.id,m.client_id,m.subject,m.recipient_email,m.created_at,m.experiment_key,
            p.company_name,p.contact_name,p.contact_title,p.qualification_score
     FROM connect_outreach_messages m
     JOIN connect_prospects p ON p.id=m.prospect_id
     WHERE m.client_id=$1
       AND m.status='DRAFT'
       AND p.qualification_status='QUALIFIED'
       AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
       AND (
         (m.experiment_key=$3 AND p.outreach_status IN ('CONTACTED','QUEUED'))
         OR (coalesce(m.experiment_key,'') <> $3 AND p.outreach_status IN ('READY','QUEUED'))
       )
       AND p.suppression_status='CLEAR'
       AND p.contact_email IS NOT NULL
       AND lower(p.contact_email)=lower(m.recipient_email)
       AND public.connect_contact_is_verified(p)
       AND NOT EXISTS (
         SELECT 1 FROM connect_suppressions s
         WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
           AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
             OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
       )
       AND (m.experiment_key <> $3 OR NOT EXISTS (
         SELECT 1 FROM connect_replies r WHERE r.prospect_id=p.id
       ))
     ORDER BY p.qualification_score DESC NULLS LAST,m.created_at ASC,m.id ASC
     LIMIT $2`,
    [clientId, safeLimit, CONNECT_FOLLOW_UP_EXPERIMENT_KEY]
  );
  return rows;
}
