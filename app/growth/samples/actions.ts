"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

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
  revalidatePath("/growth");
  redirect("/growth/samples?status=updated");
}
