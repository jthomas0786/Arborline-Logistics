"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { CAMPAIGN_STAGE_CAP, previewDraftBatch } from "./batch-preview";

function text(form: FormData, name: string, max = 100) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function stageControlledOutreachBatch(form: FormData) {
  const identity = await requirePageRole(["STAFF"]);
  const clientId = text(form, "clientId", 60);
  const requested = Number(text(form, "batchSize", 2));
  const confirmation = text(form, "confirmApproval", 20);
  const batchSize = Number.isFinite(requested)
    ? Math.max(1, Math.min(CAMPAIGN_STAGE_CAP, Math.floor(requested)))
    : CAMPAIGN_STAGE_CAP;

  if (!clientId) redirect("/campaigns?staging=client_required");
  if (confirmation !== "APPROVE") redirect("/campaigns?staging=confirmation_required");

  const candidates = await previewDraftBatch(clientId, batchSize);
  const pool = getPool();
  let staged = 0;

  for (const candidate of candidates) {
    const result = await pool.query(
      `WITH approved AS (
         UPDATE connect_outreach_messages m
         SET status='QUEUED',
             approved_at=now(),
             approved_by_user_id=$3,
             approval_source='STAFF_BATCH',
             updated_at=now()
         FROM connect_prospects p
         WHERE m.id=$1
           AND m.client_id=$2
           AND m.prospect_id=p.id
           AND m.status='DRAFT'
           AND p.qualification_status='QUALIFIED'
           AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
           AND p.outreach_status IN ('READY','QUEUED')
           AND p.suppression_status='CLEAR'
           AND p.contact_email IS NOT NULL
           AND lower(p.contact_email)=lower(m.recipient_email)
           AND (
             (
               upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='PROSPEO'
               AND upper(coalesce(p.source_metadata->>'email_status',''))='VERIFIED'
             )
             OR (
               upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='HUNTER'
               AND upper(coalesce(p.source_metadata->>'email_status','')) IN ('VALID','VERIFIED')
             )
             OR (
               lower(coalesce(p.source_metadata->'hunter_verification'->>'status',''))='valid'
               AND lower(coalesce(p.source_metadata->'hunter_verification'->>'email',''))=lower(p.contact_email)
             )
             OR lower(coalesce(p.source_metadata->'hunter_email_finder'->>'verification_status','')) IN ('valid','verified')
           )
           AND NOT EXISTS (
             SELECT 1 FROM connect_suppressions s
             WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
               AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
                 OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
           )
         RETURNING m.prospect_id
       )
       UPDATE connect_prospects p
       SET outreach_status='QUEUED',updated_at=now()
       FROM approved a
       WHERE p.id=a.prospect_id AND p.outreach_status IN ('READY','QUEUED')
       RETURNING p.id`,
      [candidate.id, clientId, identity.userId]
    );
    staged += result.rowCount ?? 0;
  }

  revalidatePath("/campaigns");
  revalidatePath("/prospects");
  revalidatePath("/growth");
  redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=staged&count=${staged}`);
}
