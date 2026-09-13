"use server";

import { redirect } from "next/navigation";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { createConnectBillingPortalSession } from "@/lib/connect-stripe";
import { getPool } from "@/lib/db";

export async function openBillingPortal() {
  const { client } = await requireConnectClient();
  const { rows } = await getPool().query(
    `SELECT stripe_customer_id FROM connect_clients WHERE id=$1 LIMIT 1`,
    [client.id]
  );
  const customerId = rows[0]?.stripe_customer_id as string | null | undefined;
  if (!customerId) redirect("/portal/billing?error=not_ready");

  try {
    const url = await createConnectBillingPortalSession(customerId);
    redirect(url);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Failed to open Stripe billing portal", error);
    redirect("/portal/billing?error=portal_failed");
  }
}
