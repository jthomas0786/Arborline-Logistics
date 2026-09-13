import { redirect } from "next/navigation";
import { requirePageRole } from "./auth";
import { getPool } from "./db";

type RequireConnectClientOptions = {
  allowOnboarding?: boolean;
};

export async function requireConnectClient(options: RequireConnectClientOptions = {}) {
  const identity = await requirePageRole(["CONNECT_CLIENT"]);
  if (!identity.connectClientId) redirect("/unauthorized");

  const { rows } = await getPool().query(
    `SELECT id,company_name,website,industry,primary_contact_name,primary_contact_email,primary_contact_phone,
            service_summary,service_area,services_offered,
            business_address_line1,business_address_line2,business_city,business_state,business_postal_code,
            onboarding_completed_at,status,booking_type,timezone,billing_status,
            billing_current_period_end,billing_last_paid_at
     FROM connect_clients WHERE id=$1 LIMIT 1`,
    [identity.connectClientId]
  );
  const client = rows[0];
  if (!client) redirect("/unauthorized");

  if (!options.allowOnboarding && client.status === "ONBOARDING" && !client.onboarding_completed_at) {
    redirect("/portal/onboarding");
  }

  return { identity, client };
}
