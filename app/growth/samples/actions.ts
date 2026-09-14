"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { generateFreeSampleMatches } from "@/lib/connect-free-sample";

const allowed = new Set(["REQUESTED","IN_PROGRESS","READY","DELIVERED","DECLINED"]);

export async function updateFreeSampleStatus(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim().toUpperCase();
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
     WHERE id=$1 AND request_type='FREE_SAMPLE'`,
    [id, status]
  );

  revalidatePath("/growth/samples");
  revalidatePath(`/growth/samples/${id}/preview`);
  revalidatePath("/growth");
  redirect("/growth/samples?status=updated");
}

export async function generateFreeSample(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = String(formData.get("id") ?? "").trim();
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
        : "generation_failed";
    revalidatePath("/growth/samples");
    redirect(`/growth/samples?status=${status}&focus=${encodeURIComponent(id)}`);
  }

  revalidatePath("/growth/samples");
  revalidatePath(`/growth/samples/${id}/preview`);
  redirect(`/growth/samples?status=generated&count=${count}&focus=${encodeURIComponent(id)}`);
}

export async function setFreeSampleMatchSelected(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const requestId = String(formData.get("requestId") ?? "").trim();
  const matchId = String(formData.get("matchId") ?? "").trim();
  const selected = String(formData.get("selected") ?? "") === "true";
  if (!requestId || !matchId) redirect("/growth/samples?status=invalid");

  await getPool().query(
    `UPDATE connect_free_sample_matches m
     SET selected=$3,updated_at=now()
     WHERE m.id=$2 AND m.request_id=$1
       AND EXISTS (
         SELECT 1 FROM connect_pilot_interest i
         WHERE i.id=m.request_id AND i.request_type='FREE_SAMPLE'
       )`,
    [requestId, matchId, selected]
  );

  revalidatePath("/growth/samples");
  revalidatePath(`/growth/samples/${requestId}/preview`);
  redirect(`/growth/samples?status=selection_updated&focus=${encodeURIComponent(requestId)}`);
}
