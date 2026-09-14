"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { generateFreeSampleMatches } from "@/lib/connect-free-sample";
import { buildFreeSampleEmailDraft, sampleDeliveryConfigured, sendFreeSampleDelivery } from "@/lib/connect-free-sample-delivery";

const allowed = new Set(["REQUESTED","IN_PROGRESS","READY","DELIVERED","DECLINED"]);
const conversionAllowed = new Set(["OPEN","INTERESTED","NOT_NOW","CONVERTED","CLOSED"]);

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function refreshSample(id: string) {
  revalidatePath("/growth/samples");
  revalidatePath(`/growth/samples/${id}`);
  revalidatePath(`/growth/samples/${id}/preview`);
  revalidatePath("/growth");
}

export async function updateFreeSampleStatus(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  const status = text(formData, "status", 40).toUpperCase();
  if (!id || !allowed.has(status)) redirect("/growth/samples?status=invalid");

  const pool = getPool();
  await pool.query(
    `UPDATE connect_pilot_interest
     SET sample_status=$2,
         sample_prepared_at=CASE WHEN $2 IN ('READY','DELIVERED') THEN COALESCE(sample_prepared_at,now()) ELSE sample_prepared_at END,
         sample_delivered_at=CASE WHEN $2='DELIVERED' THEN COALESCE(sample_delivered_at,now()) ELSE sample_delivered_at END,
         status=CASE
           WHEN $2='DELIVERED' THEN 'CONTACTED'
           WHEN $2='DECLINED' THEN 'NOT_A_FIT'
           ELSE status
         END,
         updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_email_status <> 'SENDING'`,
    [id, status]
  );

  refreshSample(id);
  redirect("/growth/samples?status=updated");
}

export async function generateFreeSample(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  if (!id) redirect("/growth/samples?status=invalid");

  let count = 0;
  try {
    const generated = await generateFreeSampleMatches(id);
    count = generated.count;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "PROVIDER_SPEND_DISABLED"
      ? "provider_off"
      : message === "SAMPLE_PROVIDER_NOT_CONFIGURED"
        ? "provider_missing"
        : message === "SAMPLE_GENERATION_ALREADY_RUNNING"
          ? "already_running"
          : message === "SAMPLE_GENERATION_NOT_ALLOWED" || message === "SAMPLE_ALREADY_APPROVED"
            ? "generation_not_allowed"
            : "generation_failed";
    refreshSample(id);
    redirect(`/growth/samples?status=${status}&focus=${encodeURIComponent(id)}`);
  }

  refreshSample(id);
  redirect(`/growth/samples?status=generated&count=${count}&focus=${encodeURIComponent(id)}`);
}

export async function setFreeSampleMatchSelected(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const requestId = text(formData, "requestId", 60);
  const matchId = text(formData, "matchId", 60);
  const selected = text(formData, "selected", 10) === "true";
  if (!requestId || !matchId) redirect("/growth/samples?status=invalid");

  const changed = await getPool().query(
    `UPDATE connect_free_sample_matches m
     SET selected=$3,updated_at=now()
     WHERE m.id=$2 AND m.request_id=$1
       AND EXISTS (
         SELECT 1 FROM connect_pilot_interest i
         WHERE i.id=m.request_id AND i.request_type='FREE_SAMPLE'
           AND i.sample_approved_at IS NULL
           AND i.sample_email_status NOT IN ('SENDING','SENT')
       )
     RETURNING m.id`,
    [requestId, matchId, selected]
  );

  refreshSample(requestId);
  redirect(`/growth/samples?status=${changed.rows[0] ? "selection_updated" : "selection_locked"}&focus=${encodeURIComponent(requestId)}`);
}

export async function approveFreeSampleMatches(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  if (!id) redirect("/growth/samples?status=invalid");

  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const requestResult = await db.query(
      `SELECT id,name,work_email,company_name,target_customer,service_area,decision_maker_titles,
              sample_status,sample_approved_at,sample_email_status
       FROM connect_pilot_interest
       WHERE id=$1 AND request_type='FREE_SAMPLE'
       FOR UPDATE`,
      [id]
    );
    const request = requestResult.rows[0];
    if (!request || request.sample_status !== "READY" || request.sample_email_status === "SENT") {
      await db.query("ROLLBACK");
      redirect(`/growth/samples?status=approval_blocked&focus=${encodeURIComponent(id)}`);
    }

    const matchesResult = await db.query(
      `SELECT company_name,industry,city,state,match_score
       FROM connect_free_sample_matches
       WHERE request_id=$1 AND selected=true
       ORDER BY rank`,
      [id]
    );
    if (matchesResult.rows.length < 3 || matchesResult.rows.length > 5) {
      await db.query("ROLLBACK");
      redirect(`/growth/samples?status=approval_count&focus=${encodeURIComponent(id)}`);
    }

    const shareToken = randomUUID();
    const draft = buildFreeSampleEmailDraft(request, matchesResult.rows, shareToken);
    await db.query(
      `UPDATE connect_pilot_interest
       SET sample_approved_at=now(),sample_share_token=$2::uuid,
           sample_email_subject=$3,sample_email_body=$4,sample_email_status='DRAFT',
           sample_email_approved_at=NULL,sample_email_sent_at=NULL,sample_email_provider_message_id=NULL,
           sample_email_error=NULL,updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE'`,
      [id, shareToken, draft.subject, draft.body]
    );
    await db.query("COMMIT");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    await db.query("ROLLBACK").catch(() => undefined);
    console.error("Failed to approve free sample", error);
    redirect(`/growth/samples?status=approval_failed&focus=${encodeURIComponent(id)}`);
  } finally {
    db.release();
  }

  refreshSample(id);
  redirect(`/growth/samples/${id}?status=approved`);
}

export async function reopenFreeSampleMatches(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  if (!id) redirect("/growth/samples?status=invalid");

  const result = await getPool().query(
    `UPDATE connect_pilot_interest
     SET sample_approved_at=NULL,sample_share_token=NULL,
         sample_email_subject=NULL,sample_email_body=NULL,sample_email_status='NOT_DRAFTED',
         sample_email_approved_at=NULL,sample_email_error=NULL,updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE'
       AND sample_email_status NOT IN ('SENDING','SENT')
     RETURNING id`,
    [id]
  );

  refreshSample(id);
  redirect(`/growth/samples?status=${result.rows[0] ? "reopened" : "reopen_blocked"}&focus=${encodeURIComponent(id)}`);
}

export async function saveFreeSampleEmailDraft(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  const subject = text(formData, "subject", 180);
  const body = text(formData, "body", 6000);
  if (!id || !subject || !body) redirect(`/growth/samples/${encodeURIComponent(id)}?status=email_invalid`);

  const result = await getPool().query(
    `UPDATE connect_pilot_interest
     SET sample_email_subject=$2,sample_email_body=$3,sample_email_status='DRAFT',
         sample_email_error=NULL,updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE'
       AND sample_approved_at IS NOT NULL AND sample_share_token IS NOT NULL
       AND sample_email_status NOT IN ('SENDING','SENT')
     RETURNING id`,
    [id, subject, body]
  );

  refreshSample(id);
  redirect(`/growth/samples/${id}?status=${result.rows[0] ? "email_saved" : "email_locked"}`);
}

export async function sendApprovedFreeSample(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  if (!id) redirect("/growth/samples?status=invalid");
  const config = sampleDeliveryConfigured();
  if (!config.ready) redirect(`/growth/samples/${id}?status=delivery_locked`);

  const pool = getPool();
  const candidate = await pool.query(
    `SELECT id,work_email,sample_email_subject,sample_email_body,sample_share_token,sample_email_status
     FROM connect_pilot_interest
     WHERE id=$1 AND request_type='FREE_SAMPLE'
       AND sample_approved_at IS NOT NULL AND sample_share_token IS NOT NULL
       AND sample_email_status IN ('DRAFT','APPROVED','FAILED')
     LIMIT 1`,
    [id]
  );
  const request = candidate.rows[0];
  if (!request || !validEmail(String(request.work_email || "")) || !request.sample_email_subject || !request.sample_email_body) {
    redirect(`/growth/samples/${id}?status=delivery_blocked`);
  }

  const claimed = await pool.query(
    `UPDATE connect_pilot_interest
     SET sample_email_status='SENDING',sample_email_approved_at=COALESCE(sample_email_approved_at,now()),
         sample_email_error=NULL,updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE'
       AND sample_email_status IN ('DRAFT','APPROVED','FAILED')
     RETURNING id`,
    [id]
  );
  if (!claimed.rows[0]) redirect(`/growth/samples/${id}?status=already_sending`);

  try {
    const providerId = await sendFreeSampleDelivery({
      requestId: id,
      recipient: String(request.work_email),
      subject: String(request.sample_email_subject),
      body: String(request.sample_email_body),
      shareToken: String(request.sample_share_token)
    });
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_email_status='SENT',sample_email_provider_message_id=$2,sample_email_sent_at=now(),
           sample_email_error=NULL,sample_status='DELIVERED',sample_delivered_at=COALESCE(sample_delivered_at,now()),
           status='CONTACTED',updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_email_status='SENDING'`,
      [id, providerId]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown sample delivery error";
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_email_status='FAILED',sample_email_error=$2,updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_email_status='SENDING'`,
      [id, message]
    );
    refreshSample(id);
    redirect(`/growth/samples/${id}?status=delivery_failed`);
  }

  refreshSample(id);
  redirect(`/growth/samples/${id}?status=sent`);
}

export async function updateFreeSampleConversionStatus(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = text(formData, "id", 60);
  const status = text(formData, "status", 40).toUpperCase();
  if (!id || !conversionAllowed.has(status)) redirect("/growth/samples?status=invalid");

  await getPool().query(
    `UPDATE connect_pilot_interest
     SET sample_conversion_status=$2,sample_conversion_updated_at=now(),
         status=CASE
           WHEN $2='INTERESTED' THEN 'QUALIFIED'
           WHEN $2='CONVERTED' THEN 'CLOSED'
           ELSE status
         END,
         updated_at=now()
     WHERE id=$1 AND request_type='FREE_SAMPLE'`,
    [id, status]
  );

  refreshSample(id);
  redirect(`/growth/samples/${id}?status=conversion_updated`);
}
