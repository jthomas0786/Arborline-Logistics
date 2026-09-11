import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { resolveLocation } from "@/lib/geocoding";
import { priceQuote } from "@/lib/pricing";
import { estimateRouteMiles } from "@/lib/routing";
import { canCreateQuote, getShipperCreditSnapshot, recordCreditEvent } from "@/lib/shipper-credit";
import type { EquipmentType } from "@/lib/types";

const equipment = new Set<EquipmentType>(["DRY_VAN","REEFER","FLATBED"]);
const publicQuoteFields = `
  id, reference_number, status, origin_city, origin_state,
  destination_city, destination_state, pickup_start, equipment_type,
  estimated_miles, weight_lbs, commodity, shipper_price, expires_at
`;

export async function GET() {
  const access = await requireApiRole(["STAFF", "SHIPPER"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    if (access.identity.role === "SHIPPER" && !access.identity.shipperId) return NextResponse.json({ quotes: [] });
    const query = access.identity.role === "SHIPPER"
      ? `SELECT ${publicQuoteFields} FROM quotes WHERE shipper_id=$1 ORDER BY created_at DESC LIMIT 50`
      : `SELECT ${publicQuoteFields} FROM quotes ORDER BY created_at DESC LIMIT 50`;
    const values = access.identity.role === "SHIPPER" ? [access.identity.shipperId] : [];
    const { rows } = await getPool().query(query, values);
    return NextResponse.json({ quotes: rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fetch quotes" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await requireApiRole(["STAFF", "SHIPPER"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const body = await request.json();
    const required = ["originCity","originState","destinationCity","destinationState","pickupStart","equipmentType"];
    const missing = required.filter((field) => body[field] === undefined || body[field] === "");
    if (missing.length) return NextResponse.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    if (!equipment.has(body.equipmentType)) return NextResponse.json({ error: "Unsupported equipmentType" }, { status: 400 });
    if (Number.isNaN(new Date(body.pickupStart).getTime())) return NextResponse.json({ error: "pickupStart must be a valid date/time" }, { status: 400 });

    const shipperId = access.identity.role === "SHIPPER" ? access.identity.shipperId : typeof body.shipperId === "string" ? body.shipperId : null;
    if (!shipperId) {
      return NextResponse.json({ error: access.identity.role === "SHIPPER" ? "Complete shipper onboarding before requesting a quote." : "Select a shipper before creating a quote." }, { status: 409 });
    }

    let estimatedMiles = Number(body.estimatedMiles);
    let routeEstimate = null;
    if (!Number.isFinite(estimatedMiles) || estimatedMiles <= 0) {
      routeEstimate = await estimateRouteMiles(body.originCity, body.originState, body.destinationCity, body.destinationState);
      if (!routeEstimate) return NextResponse.json({ error: "Unable to estimate route miles. Enter estimated miles manually." }, { status: 422 });
      estimatedMiles = routeEstimate.miles;
    }

    const pricing = priceQuote({ equipmentType: body.equipmentType, estimatedMiles, pickupAt: body.pickupStart, weightLbs: Number(body.weightLbs || 0) });
    const snapshot = await getShipperCreditSnapshot(shipperId);
    if (!snapshot) return NextResponse.json({ error: "Shipper account not found." }, { status: 404 });
    const quoteDecision = canCreateQuote(snapshot);
    if (!quoteDecision.allowed) {
      await recordCreditEvent(getPool(), {
        shipperId,
        eventType: "QUOTE_BLOCKED",
        creditLimit: snapshot.effectiveLimit,
        exposureBefore: snapshot.exposure,
        requestedAmount: pricing.shipperPrice,
        decision: "DENY",
        reason: quoteDecision.reason,
        actorUserId: access.identity.userId
      });
      return NextResponse.json({ error: quoteDecision.reason, code: "CREDIT_BLOCKED" }, { status: 409 });
    }

    const origin = routeEstimate?.origin ?? resolveLocation(body.originCity, body.originState, { lat: body.originLat === undefined ? undefined : Number(body.originLat), lon: body.originLon === undefined ? undefined : Number(body.originLon) });
    const destination = routeEstimate?.destination ?? resolveLocation(body.destinationCity, body.destinationState, { lat: body.destinationLat === undefined ? undefined : Number(body.destinationLat), lon: body.destinationLon === undefined ? undefined : Number(body.destinationLon) });
    const reference = `AQ-${Date.now().toString().slice(-8)}`;
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO quotes (reference_number,shipper_id,status,origin_city,origin_state,origin_location,destination_city,destination_state,destination_location,pickup_start,equipment_type,estimated_miles,weight_lbs,commodity,cargo_value,expected_carrier_cost,target_carrier_rate,max_carrier_rate,shipper_price,target_margin_pct,pricing_notes,expires_at)
         VALUES ($1,$2,'OPEN',$3,$4,CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END,$7,$8,CASE WHEN $9::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($10,$9),4326)::geography END,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,now()+interval '2 hours')
         RETURNING ${publicQuoteFields}`,
        [reference,shipperId,body.originCity,body.originState,origin?.lat ?? null,origin?.lon ?? null,body.destinationCity,body.destinationState,destination?.lat ?? null,destination?.lon ?? null,body.pickupStart,body.equipmentType,estimatedMiles,Number(body.weightLbs || 0)||null,body.commodity || null,Number(body.cargoValue || 0)||null,pricing.expectedCarrierCost,pricing.targetCarrierRate,pricing.maxCarrierRate,pricing.shipperPrice,pricing.targetMarginPct,JSON.stringify(pricing.pricingNotes)]
      );
      await recordCreditEvent(client, {
        shipperId,
        quoteId: rows[0].id,
        eventType: "QUOTE_ALLOWED",
        creditLimit: snapshot.effectiveLimit,
        exposureBefore: snapshot.exposure,
        requestedAmount: pricing.shipperPrice,
        decision: "ALLOW",
        actorUserId: access.identity.userId,
        metadata: { creditStatus: snapshot.creditStatus }
      });
      await client.query("COMMIT");
      return NextResponse.json({ quote: rows[0] }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create quote" }, { status: 400 });
  }
}
