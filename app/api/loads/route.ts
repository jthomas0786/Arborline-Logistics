import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT id, reference_number, status, origin_city, origin_state,
             destination_city, destination_state, pickup_start,
             equipment_type, shipper_rate, target_carrier_rate, created_at
      FROM loads
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return NextResponse.json({ loads: rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fetch loads" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const required = ["originCity", "originState", "destinationCity", "destinationState", "pickupStart", "equipmentType"];
    const missing = required.filter((key) => !body[key]);
    if (missing.length) return NextResponse.json({ error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });

    const pool = getPool();
    const reference = `AL-${Date.now().toString().slice(-8)}`;
    const { rows } = await pool.query(
      `INSERT INTO loads (
        reference_number, status, origin_city, origin_state,
        destination_city, destination_state, pickup_start,
        equipment_type, weight_lbs, commodity, cargo_value,
        shipper_rate, target_carrier_rate, max_carrier_rate
      ) VALUES ($1,'SEARCHING',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [reference, body.originCity, body.originState, body.destinationCity, body.destinationState,
       body.pickupStart, body.equipmentType, body.weightLbs ?? null, body.commodity ?? null,
       body.cargoValue ?? null, body.shipperRate ?? null, body.targetCarrierRate ?? null, body.maxCarrierRate ?? null]
    );
    return NextResponse.json({ load: rows[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create load" }, { status: 500 });
  }
}
