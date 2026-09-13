"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

const REQUEST_STATUSES = new Set(["SUBMITTED","IN_REVIEW","COMPLETED","DECLINED"]);

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function updateClientRequestStatus(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = text(form, "clientId", 60);
  const requestId = text(form, "requestId", 60);
  const status = text(form, "status", 30);
  const staffNotes = text(form, "staffNotes", 2000) || null;

  if (!clientId || !requestId || !REQUEST_STATUSES.has(status)) {
    redirect(`/clients/${clientId || ""}?request=invalid`);
  }

  const result = await getPool().query(
    `UPDATE connect_client_requests
     SET status=$3,staff_notes=$4,
         resolved_at=CASE WHEN $3 IN ('COMPLETED','DECLINED') THEN COALESCE(resolved_at,now()) ELSE NULL END,
         updated_at=now()
     WHERE id=$1 AND client_id=$2
     RETURNING id`,
    [requestId,clientId,status,staffNotes]
  );

  if (!result.rows[0]) redirect(`/clients/${clientId}?request=not_found`);

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  revalidatePath("/operations");
  revalidatePath("/portal/targeting");
  redirect(`/clients/${clientId}?request=updated`);
}
