"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { CAMPAIGN_STAGE_CAP, previewDraftBatch } from "./batch-preview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(form: FormData, name: string, max = 100) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function exactMessageIds(form: FormData) {
  const ids = form.getAll("messageId")
    .map((value) => String(value).trim())
    .filter((value) => UUID.test(value));
  return [...new Set(ids)].slice(0, CAMPAIGN_STAGE_CAP);
}

export async function stageControlledOutreachBatch(form: FormData) {
  const identity = await requirePageRole(["STAFF"]);
  const clientId = text(form, "clientId", 60);
  const confirmation = text(form, "confirmApproval", 20);
  const approvalText = text(form, "approvalText", 40);
  const messageIds = exactMessageIds(form);

  if (!clientId) redirect("/campaigns?staging=client_required");
  if (!messageIds.length) redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=empty`);
  if (confirmation !== "APPROVE" || approvalText !== "APPROVE BATCH") {
    redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=confirmation_required`);
  }

  // Bind approval to the exact drafts shown in the preview. A stale/replayed form can
  // never advance into a newer batch just because the queue changed underneath it.
  const currentPreview = await previewDraftBatch(clientId, CAMPAIGN_STAGE_CAP);
  const expectedIds = currentPreview.slice(0, messageIds.length).map((row) => String(row.id));
  if (expectedIds.length !== messageIds.length || expectedIds.some((id, index) => id !== messageIds[index])) {
    redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=stale`);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const approved = await client.query(
      `UPDATE connect_outreach_messages m
       SET status='QUEUED',
           approved_at=now(),
           approved_by_user_id=$3,
           approval_source='STAFF_BATCH_CONFIRMED',
           updated_at=now()
       FROM connect_prospects p
       WHERE m.id = ANY($1::uuid[])
         AND m.client_id=$2
         AND m.prospect_id=p.id
         AND m.status='DRAFT'
         AND p.qualification_status='QUALIFIED'
         AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')
         AND p.outreach_status IN ('READY','QUEUED')
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
       RETURNING m.id,m.prospect_id`,
      [messageIds, clientId, identity.userId]
    );

    if ((approved.rowCount ?? 0) !== messageIds.length) {
      await client.query("ROLLBACK");
      redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=blocked`);
    }

    const prospectIds = approved.rows.map((row) => row.prospect_id);
    await client.query(
      `UPDATE connect_prospects
       SET outreach_status='QUEUED',updated_at=now()
       WHERE id = ANY($1::uuid[])
         AND outreach_status IN ('READY','QUEUED')`,
      [prospectIds]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  revalidatePath("/campaigns");
  revalidatePath("/prospects");
  revalidatePath("/growth");
  redirect(`/campaigns?batchClient=${encodeURIComponent(clientId)}&staging=approved&count=${messageIds.length}`);
}
