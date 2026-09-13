import { redirect } from "next/navigation";
import { requirePageRole } from "./auth";
import { getPool } from "./db";

export async function requireConnectClient() {
  const identity = await requirePageRole(["CONNECT_CLIENT"]);
  if (!identity.connectClientId) redirect("/unauthorized");

  const { rows } = await getPool().query(
    `SELECT id,company_name,website,industry,primary_contact_name,primary_contact_email,
            service_summary,service_area,status,booking_type,timezone,billing_status,
            billing_current_period_end,billing_last_paid_at
     FROM connect_clients WHERE id=$1 LIMIT 1`,
    [identity.connectClientId]
  );
  const client = rows[0];
  if (!client) redirect("/unauthorized");
  return { identity, client };
}
