"use server";

import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { createFoundingClientCheckout } from "@/lib/connect-stripe";

function text(form: FormData, name: string, max = 200) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function startFoundingClientCheckout(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = text(form, "clientId", 60);
  if (!clientId) redirect("/clients?billing=invalid_client");

  const pool = getPool();
  const result = await pool.query(
    `SELECT id, company_name, primary_contact_email, stripe_customer_id
     FROM connect_clients
     WHERE id=$1
     LIMIT 1`,
    [clientId]
  );
  const client = result.rows[0];
  if (!client) redirect("/clients?billing=invalid_client");

  try {
    const checkout = await createFoundingClientCheckout({
      id: client.id,
      companyName: client.company_name,
      email: client.primary_contact_email || null,
      stripeCustomerId: client.stripe_customer_id || null
    });

    await pool.query(
      `UPDATE connect_clients
       SET billing_status='PENDING', stripe_checkout_session_id=$2, updated_at=now()
       WHERE id=$1`,
      [clientId, checkout.id]
    );

    redirect(checkout.url);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Failed to start Stripe checkout", error);
    redirect(`/clients/${clientId}?billing=checkout_error`);
  }
}
