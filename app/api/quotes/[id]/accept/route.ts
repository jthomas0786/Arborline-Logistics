import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { canAcceptQuote, getShipperCreditSnapshot, recordCreditEvent } from "@/lib/shipper-credit";
import { runAutopilot } from "@/lib/workflow";

function publicFulfillment(status: string) {
  if (status === "BOOKED") return { status: "BOOKED", message: "Your shipment is booked and Arborline is preparing dispatch details." };
  if (status === "EXCEPTION") return { status: "REVIEW", message: "Your shipment is accepted and Arborline is reviewing capacity." };
  return { status: "SECURING_CAPACITY", message: "Your shipment is accepted and Arborline is securing a carrier." };
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(["STAFF", "SHIPPER"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await context.params;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quoteResult = await client.query(`SELECT * FROM quotes WHERE id=$1 FOR UPDATE`, [id]);
    const quote = quoteResult.rows[0];
    if (!quote) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Quote not found" }, { status: 404 }); }
    if (access.identity.role === "SHIPPER" && quote.shipper_id !== access.identity.shipperId) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (!quote.shipper_id) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This quote has no shipper billing identity and cannot be accepted." }, { status: 409 });
    }
    if (quote.status !== "OPEN") { await client.query("ROLLBACK"); return NextResponse.json({ error: `Quote is ${quote.status}` }, { status: 409 }); }
    if (new Date(quote.expires_at).getTime() < Date.now()) {
      await client.query(`UPDATE quotes SET status='EXPIRED' WHERE id=$1`, [id]);
      await client.query("COMMIT");
      return NextResponse.json({ error: "Quote expired" }, { status: 409 });
    }

    // Serialize all acceptance decisions for a shipper so concurrent quotes cannot oversubscribe one credit line.
    await client.query(`SELECT id FROM shippers WHERE id=$1 FOR UPDATE`, [quote.shipper_id]);
    const snapshot = await getShipperCreditSnapshot(quote.shipper_id, client);
    if (!snapshot) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Shipper account not found." }, { status: 404 });
    }
    const requestedAmount = Number(quote.shipper_price);
    const creditDecision = canAcceptQuote(snapshot, requestedAmount);
    if (!creditDecision.allowed) {
      await recordCreditEvent(client, {
        shipperId: quote.shipper_id,
        quoteId: id,
        eventType: "ACCEPTANCE_BLOCKED",
        creditLimit: snapshot.effectiveLimit,
        exposureBefore: snapshot.exposure,
        requestedAmount,
        projectedExposure: creditDecision.projectedExposure,
        decision: "DENY",
        reason: creditDecision.reason,
        actorUserId: access.identity.userId,
        metadata: { creditStatus: snapshot.creditStatus, overrideId: snapshot.overrideId }
      });
      await client.query("COMMIT");
      return NextResponse.json({
        error: creditDecision.reason,
        code: "CREDIT_BLOCKED",
        credit: {
          status: snapshot.creditStatus,
          exposure: snapshot.exposure,
          effectiveLimit: snapshot.effectiveLimit,
          projectedExposure: creditDecision.projectedExposure
        }
      }, { status: 409 });
    }

    const reference = `AL-${Date.now().toString().slice(-8)}`;
    const loadResult = await client.query(
      `INSERT INTO loads (
         quote_id,reference_number,shipper_id,status,origin_city,origin_state,origin_location,
         destination_city,destination_state,destination_location,pickup_start,
         equipment_type,weight_lbs,commodity,cargo_value,shipper_rate,target_carrier_rate,max_carrier_rate
       )
       SELECT id,$2,shipper_id,'SEARCHING',origin_city,origin_state,origin_location,
              destination_city,destination_state,destination_location,pickup_start,
              equipment_type,weight_lbs,commodity,cargo_value,shipper_price,target_carrier_rate,max_carrier_rate
       FROM quotes WHERE id=$1
       RETURNING id,reference_number,status,origin_city,origin_state,destination_city,destination_state,pickup_start,equipment_type,shipper_rate`,
      [id, reference]
    );
    await client.query(`UPDATE quotes SET status='ACCEPTED',accepted_at=now() WHERE id=$1`, [id]);
    await client.query(`INSERT INTO load_events (load_id,event_type,metadata) VALUES ($1,'QUOTE_ACCEPTED',$2::jsonb)`, [loadResult.rows[0].id, JSON.stringify({ quoteId: id, shipperPrice: requestedAmount })]);
    await recordCreditEvent(client, {
      shipperId: quote.shipper_id,
      quoteId: id,
      eventType: "ACCEPTANCE_ALLOWED",
      creditLimit: snapshot.effectiveLimit,
      exposureBefore: snapshot.exposure,
      requestedAmount,
      projectedExposure: creditDecision.projectedExposure,
      decision: "ALLOW",
      actorUserId: access.identity.userId,
      metadata: { loadId: loadResult.rows[0].id, overrideId: snapshot.overrideId }
    });
    await client.query("COMMIT");

    const autopilot = await runAutopilot(loadResult.rows[0].id);
    return NextResponse.json({ load: loadResult.rows[0], fulfillment: publicFulfillment(autopilot.status) }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to accept quote" }, { status: 500 });
  } finally { client.release(); }
}
