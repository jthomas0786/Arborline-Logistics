import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getShipperCreditSnapshot, recordCreditEvent } from "@/lib/shipper-credit";

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const access = await requireApiRole(["SHIPPER"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.identity.shipperId) return NextResponse.json({ profile: null, credit: null });
  const { rows } = await getPool().query(
    `SELECT s.id,o.legal_name,o.dba_name,s.onboarding_status,s.billing_contact_name,s.billing_email,s.billing_phone,
            s.billing_address_line1,s.billing_address_line2,s.billing_city,s.billing_state,s.billing_postal_code
     FROM shippers s JOIN organizations o ON o.id=s.organization_id WHERE s.id=$1`,
    [access.identity.shipperId]
  );
  return NextResponse.json({ profile: rows[0] ?? null, credit: await getShipperCreditSnapshot(access.identity.shipperId) });
}

export async function PUT(request: Request) {
  const access = await requireApiRole(["SHIPPER"]);
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
    let shipperId = access.identity.shipperId;
    let organizationId = access.identity.organizationId;
    let created = false;
    if (!shipperId) {
      const org = await client.query(
        `INSERT INTO organizations (type,legal_name,dba_name,status) VALUES ('SHIPPER',$1,$2,'ACTIVE') RETURNING id`,
        [legalName,dbaName || null]
      );
      organizationId = org.rows[0].id;
      const shipper = await client.query(
        `INSERT INTO shippers
          (organization_id,onboarding_status,credit_status,credit_limit,payment_terms_days,risk_score,billing_contact_name,billing_email,billing_phone,billing_address_line1,billing_address_line2,billing_city,billing_state,billing_postal_code)
         VALUES ($1,'COMPLETE','PENDING',NULL,30,0,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [organizationId,billingContactName,billingEmail,billingPhone || null,address1,address2 || null,city,state,postalCode]
      );
      shipperId = shipper.rows[0].id;
      await client.query(`UPDATE app_users SET organization_id=$2,shipper_id=$3 WHERE user_id=$1`, [access.identity.userId,organizationId,shipperId]);
      created = true;
    } else {
      const current = await client.query(`SELECT organization_id FROM shippers WHERE id=$1 FOR UPDATE`, [shipperId]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Shipper account not found." }, { status: 404 });
      }
      organizationId = current.rows[0].organization_id;
      await client.query(`UPDATE organizations SET legal_name=$2,dba_name=$3 WHERE id=$1`, [organizationId,legalName,dbaName || null]);
      await client.query(
        `UPDATE shippers SET onboarding_status='COMPLETE',billing_contact_name=$2,billing_email=$3,billing_phone=$4,
          billing_address_line1=$5,billing_address_line2=$6,billing_city=$7,billing_state=$8,billing_postal_code=$9
         WHERE id=$1`,
        [shipperId,billingContactName,billingEmail,billingPhone || null,address1,address2 || null,city,state,postalCode]
      );
    }

    await recordCreditEvent(client, {
      shipperId,
      eventType: created ? "SHIPPER_SELF_ONBOARDED" : "SHIPPER_PROFILE_UPDATED",
      newStatus: "PENDING",
      decision: "REVIEW",
      reason: created ? "Shipper completed onboarding and is awaiting credit review." : "Shipper updated billing profile.",
      actorUserId: access.identity.userId
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, shipperId, credit: await getShipperCreditSnapshot(shipperId) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save shipper profile." }, { status: 500 });
  } finally {
    client.release();
  }
}
