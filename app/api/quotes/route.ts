import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { resolveLocation } from "@/lib/geocoding";
import { priceQuote } from "@/lib/pricing";
import { estimateRouteMiles } from "@/lib/routing";
import type { EquipmentType } from "@/lib/types";

const equipment = new Set<EquipmentType>(["DRY_VAN","REEFER","FLATBED"]);

export async function GET() {
  try {
    const { rows } = await getPool().query(`SELECT * FROM quotes ORDER BY created_at DESC LIMIT 50`);
    return NextResponse.json({ quotes: rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fetch quotes" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const required = ["originCity","originState","destinationCity","destinationState","pickupStart","equipmentType"];
    const missing = required.filter((field) => body[field] === undefined || body[field] === "");
    if (missing.length) return NextResponse.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    if (!equipment.has(body.equipmentType)) return NextResponse.json({ error: "Unsupported equipmentType" }, { status: 400 });
    if (Number.isNaN(new Date(body.pickupStart).getTime())) return NextResponse.json({ error: "pickupStart must be a valid date/time" }, { status: 400 });

    let estimatedMiles = Number(body.estimatedMiles);
    let routeEstimate = null;
    if (!Number.isFinite(estimatedMiles) || estimatedMiles <= 0) {
      routeEstimate = await estimateRouteMiles(body.originCity, body.originState, body.destinationCity, body.destinationState);
      if (!routeEstimate) return NextResponse.json({ error: "Unable to estimate route miles. Enter estimated miles manually." }, { status: 422 });
      estimatedMiles = routeEstimate.miles;
    }

    const pricing = priceQuote({ equipmentType: body.equipmentType, estimatedMiles, pickupAt: body.pickupStart, weightLbs: Number(body.weightLbs || 0) });
    const origin = routeEstimate?.origin ?? resolveLocation(body.originCity, body.originState, { lat: body.originLat === undefined ? undefined : Number(body.originLat), lon: body.originLon === undefined ? undefined : Number(body.originLon) });
    const destination = routeEstimate?.destination ?? resolveLocation(body.destinationCity, body.destinationState, { lat: body.destinationLat === undefined ? undefined : Number(body.destinationLat), lon: body.destinationLon === undefined ? undefined : Number(body.destinationLon) });
    const reference = `AQ-${Date.now().toString().slice(-8)}`;
    const { rows } = await getPool().query(
      `INSERT INTO quotes (reference_number,status,origin_city,origin_state,origin_location,destination_city,destination_state,destination_location,pickup_start,equipment_type,estimated_miles,weight_lbs,commodity,cargo_value,expected_carrier_cost,target_carrier_rate,max_carrier_rate,shipper_price,target_margin_pct,pricing_notes,expires_at)
       VALUES ($1,'OPEN',$2,$3,CASE WHEN $4::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$4),4326)::geography END,$6,$7,CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($9,$8),4326)::geography END,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,now()+interval '2 hours') RETURNING *`,
      [reference,body.originCity,body.originState,origin?.lat ?? null,origin?.lon ?? null,body.destinationCity,body.destinationState,destination?.lat ?? null,destination?.lon ?? null,body.pickupStart,body.equipmentType,estimatedMiles,Number(body.weightLbs || 0)||null,body.commodity || null,Number(body.cargoValue || 0)||null,pricing.expectedCarrierCost,pricing.targetCarrierRate,pricing.maxCarrierRate,pricing.shipperPrice,pricing.targetMarginPct,JSON.stringify(pricing.pricingNotes)]
    );
    return NextResponse.json({ quote: rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create quote" }, { status: 400 });
  }
}
