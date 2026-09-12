import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyStripeWebhookSignature } from "@/lib/connect-stripe";

export const dynamic = "force-dynamic";

type StripeEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: { object?: Record<string, any> };
};

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function subscriptionIdFromInvoice(invoice: Record<string, any>) {
  return (
    stringValue(invoice.subscription) ||
    stringValue(invoice.parent?.subscription_details?.subscription) ||
    null
  );
}

function mapSubscriptionStatus(status: unknown) {
  switch (status) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    default:
      return "PENDING";
  }
}

export async function POST(request: Request) {
  const payload = await request.text();
  if (!verifyStripeWebhookSignature(payload, request.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!event.id || !event.type || !event.data?.object) {
    return NextResponse.json({ error: "Incomplete Stripe event" }, { status: 400 });
  }

  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const inserted = await db.query(
      `INSERT INTO connect_stripe_webhook_events (id,event_type,livemode,payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [event.id, event.type, Boolean(event.livemode), payload]
    );

    if (!inserted.rowCount) {
      await db.query("ROLLBACK");
      return NextResponse.json({ received: true, duplicate: true });
    }

    const object = event.data.object;

    if (event.type === "checkout.session.completed") {
      const clientId = stringValue(object.client_reference_id) || stringValue(object.metadata?.client_id);
      if (clientId) {
        await db.query(
          `UPDATE connect_clients SET
             billing_status=CASE WHEN $5='paid' THEN 'ACTIVE' ELSE 'PENDING' END,
             stripe_customer_id=COALESCE($2,stripe_customer_id),
             stripe_subscription_id=COALESCE($3,stripe_subscription_id),
             stripe_checkout_session_id=COALESCE($4,stripe_checkout_session_id),
             updated_at=now()
           WHERE id=$1`,
          [
            clientId,
            stringValue(object.customer),
            stringValue(object.subscription),
            stringValue(object.id),
            stringValue(object.payment_status)
          ]
        );
      }
    }

    if (event.type === "invoice.paid") {
      const subscriptionId = subscriptionIdFromInvoice(object);
      const customerId = stringValue(object.customer);
      await db.query(
        `UPDATE connect_clients SET
           billing_status='ACTIVE',
           stripe_latest_invoice_id=COALESCE($1,stripe_latest_invoice_id),
           billing_last_paid_at=now(),
           updated_at=now()
         WHERE ($2::text IS NOT NULL AND stripe_subscription_id=$2)
            OR ($3::text IS NOT NULL AND stripe_customer_id=$3)`,
        [stringValue(object.id), subscriptionId, customerId]
      );
    }

    if (event.type === "invoice.payment_failed") {
      const subscriptionId = subscriptionIdFromInvoice(object);
      const customerId = stringValue(object.customer);
      await db.query(
        `UPDATE connect_clients SET billing_status='PAST_DUE', updated_at=now()
         WHERE ($1::text IS NOT NULL AND stripe_subscription_id=$1)
            OR ($2::text IS NOT NULL AND stripe_customer_id=$2)`,
        [subscriptionId, customerId]
      );
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const status = mapSubscriptionStatus(object.status);
      const currentPeriodEnd = typeof object.current_period_end === "number"
        ? new Date(object.current_period_end * 1000).toISOString()
        : null;
      await db.query(
        `UPDATE connect_clients SET
           billing_status=$2,
           stripe_customer_id=COALESCE($3,stripe_customer_id),
           billing_current_period_end=COALESCE($4::timestamptz,billing_current_period_end),
           updated_at=now()
         WHERE stripe_subscription_id=$1`,
        [stringValue(object.id), status, stringValue(object.customer), currentPeriodEnd]
      );
    }

    if (event.type === "customer.subscription.deleted") {
      await db.query(
        `UPDATE connect_clients SET billing_status='CANCELED', updated_at=now()
         WHERE stripe_subscription_id=$1`,
        [stringValue(object.id)]
      );
    }

    await db.query("COMMIT");
    return NextResponse.json({ received: true });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    console.error("Stripe webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  } finally {
    db.release();
  }
}
