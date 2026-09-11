import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { recordCreditEvent } from "@/lib/shipper-credit";

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  const { rows } = await getPool().query(
    `SELECT s.id,o.legal_name,o.dba_name,o.status organization_status,s.onboarding_status,s.credit_status,
            s.credit_limit,s.payment_terms_days,s.risk_score,s.billing_contact_name,s.billing_email,s.billing_phone,
            COALESCE(ar.open_ar,0) open_ar,COALESCE(freight.uninvoiced_exposure,0) uninvoiced_exposure,
            ov.id override_id,ov.max_exposure override_max_exposure,ov.expires_at override_expires_at
     FROM shippers s
     JOIN organizations o ON o.id=s.organization_id
     LEFT JOIN LATERAL (SELECT COALESCE(sum(amount),0) open_ar FROM shipper_invoices i WHERE i.shipper_id=s.id AND i.status='ISSUED') ar ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(shipper_rate),0) uninvoiced_exposure FROM loads l
       WHERE l.shipper_id=s.id AND l.status IN ('SEARCHING','OFFERING','BOOKED','DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY','DELIVERED','POD_RECEIVED')
     ) freight ON true
     LEFT JOIN LATERAL (
       SELECT id,max_exposure,expires_at FROM shipper_credit_overrides
       WHERE shipper_id=s.id AND revoked_at IS NULL AND expires_at>now()
       ORDER BY max_exposure DESC,created_at DESC LIMIT 1
     ) ov ON true
     ORDER BY o.legal_name`
  );
  return NextResponse.json({ shippers: rows });
}

export async function POST(request: Request) {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => ({}));
  const legalName = clean(body.legalName);
  const dbaName = clean(body.dbaName);
  const billingContactName = clean(body.billingContactName);
  const billingEmail = clean(body.billingEmail).toLowerCase();
  const billingPhone = clean(body.billingPhone, 50);
  const address1 = clean(body.billingAddressLine1);
  const address2 = clean(body.billingAddressLine2);
  const city = clean(body.billingCity);
  const state = clean(body.billingState, 2).toUpperCase();
  const postalCode = clean(body.billingPostalCode, 20);
  if (!legalName || !billingContactName || !billingEmail || !billingEmail.includes("@") || !address1 || !city || state.length !== 2 || !postalCode) {
    return NextResponse.json({ error: "Legal name, billing contact/email, and complete billing address are required." }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const org = await client.query(
      `INSERT INTO organizations (type,legal_name,dba_name,status) VALUES ('SHIPPER',$1,$2,'ACTIVE') RETURNING id`,
      [legalName,dbaName || null]
    );
    const shipper = await client.query(
      `INSERT INTO shippers
        (organization_id,onboarding_status,credit_status,credit_limit,payment_terms_days,risk_score,billing_contact_name,billing_email,billing_phone,billing_address_line1,billing_address_line2,billing_city,billing_state,billing_postal_code)
       VALUES ($1,'COMPLETE','PENDING',NULL,30,0,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,onboarding_status,credit_status`,
      [org.rows[0].id,billingContactName,billingEmail,billingPhone || null,address1,address2 || null,city,state,postalCode]
    );
    await recordCreditEvent(client, {
      shipperId: shipper.rows[0].id,
      eventType: "SHIPPER_CREATED",
      newStatus: "PENDING",
      decision: "REVIEW",
      reason: "Staff-created shipper profile awaiting credit review.",
      actorUserId: access.identity.userId
    });
    await client.query("COMMIT");
    return NextResponse.json({ shipper: { id: shipper.rows[0].id, legalName, onboardingStatus: "COMPLETE", creditStatus: "PENDING" } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create shipper." }, { status: 500 });
  } finally {
    client.release();
  }
}
