"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";

export async function submitTargetingRequest(formData: FormData) {
  const { identity, client } = await requireConnectClient();
  const message = String(formData.get("message") ?? "").trim().replace(/\r\n/g, "\n").slice(0, 4000);

  if (message.length < 10) redirect("/portal/targeting?request=invalid");

  await getPool().query(
    `INSERT INTO connect_client_requests
      (client_id,requested_by,requested_by_email,category,message,status)
     SELECT $1,$2,$3,'TARGETING',$4,'SUBMITTED'
     WHERE NOT EXISTS (
       SELECT 1 FROM connect_client_requests
       WHERE client_id=$1 AND category='TARGETING' AND message=$4
         AND created_at > now() - interval '5 minutes'
     )`,
    [client.id, identity.userId, identity.email, message]
  );

  revalidatePath("/portal/targeting");
  revalidatePath("/clients");
  revalidatePath(`/clients/${client.id}`);
  revalidatePath("/operations");
  redirect("/portal/targeting?request=submitted");
}
