import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const statusEvents = new Set(["AT_PICKUP","LOADED","IN_TRANSIT","AT_DELIVERY","DELIVERED"]);
const eventTypes = new Set(["LOCATION","ETA",...statusEvents]);
const allowedTransitions: Record<string, string[]> = {
  DISPATCHED: ["AT_PICKUP"],
  AT_PICKUP: ["LOADED"],
  LOADED: ["IN_TRANSIT"],
  IN_TRANSIT: ["AT_DELIVERY"],
  AT_DELIVERY: ["DELIVERED"]
};

function parseCoordinate(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json().catch(() => ({}));
  const eventType = String(body.eventType ?? "LOCATION").toUpperCase();
  if (!eventTypes.has(eventType)) return NextResponse.json({ error: "Unsupported tracking event" }, { status: 400 });

  const lat = body.lat === undefined || body.lat === null ? null : parseCoordinate(body.lat);
  const lon = body.lon === undefined || body.lon === null ? null : parseCoordinate(body.lon);
  if ((lat === null) !== (lon === null)) return NextResponse.json({ error: "Latitude and longitude must be provided together" }, { status: 400 });
  if (lat !== null && (lat < -90 || lat > 90 || lon! < -180 || lon! > 180)) return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  if (eventType === "LOCATION" && lat === null) return NextResponse.json({ error: "Location update requires coordinates" }, { status: 400 });

  let etaAt: Date | null = null;
  if (body.etaAt) {
    etaAt = new Date(body.etaAt);
    if (Number.isNaN(etaAt.getTime())) return NextResponse.json({ error: "Invalid ETA" }, { status: 400 });
  }
  if (eventType === "ETA" && !etaAt) return NextResponse.json({ error: "ETA is required" }, { status: 400 });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT b.id booking_id,b.load_id,b.truck_id,b.driver_id,l.status,l.reference_number
       FROM bookings b JOIN loads l ON l.id=b.load_id
       WHERE b.tracking_token=$1
       FOR UPDATE OF b,l`,
      [token]
    );
    const tracking = rows[0];
    if (!tracking) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Tracking link not found" }, { status: 404 });
    }
    if (!tracking.driver_id) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Driver has not been assigned" }, { status: 409 });
    }

    let nextStatus = tracking.status as string;
    if (statusEvents.has(eventType)) {
      if (eventType !== tracking.status && !(allowedTransitions[tracking.status] ?? []).includes(eventType)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `Cannot move load from ${tracking.status} to ${eventType}` }, { status: 409 });
      }
      nextStatus = eventType;
      await client.query(
        `UPDATE loads SET status=$2::load_status,delivered_at=CASE WHEN $2='DELIVERED' THEN COALESCE(delivered_at,now()) ELSE delivered_at END WHERE id=$1`,
        [tracking.load_id, nextStatus]
      );
    }

    if (lat !== null || etaAt) {
      await client.query(
        `UPDATE bookings
         SET tracking_started_at=COALESCE(tracking_started_at,now()),
             last_location=CASE WHEN $2::double precision IS NULL THEN last_location ELSE ST_SetSRID(ST_MakePoint($3,$2),4326)::geography END,
             last_location_at=CASE WHEN $2::double precision IS NULL THEN last_location_at ELSE now() END,
             eta_at=COALESCE($4::timestamptz,eta_at)
         WHERE id=$1`,
        [tracking.booking_id, lat, lon, etaAt ? etaAt.toISOString() : null]
      );
      if (tracking.truck_id && lat !== null) {
        await client.query(
          `UPDATE trucks SET current_location=ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,location_updated_at=now() WHERE id=$1`,
          [tracking.truck_id, lat, lon]
        );
      }
    }

    const recordedType = eventType === "ETA" ? "ETA_UPDATED" : eventType === "LOCATION" ? "LOCATION_UPDATE" : eventType;
    await client.query(
      `INSERT INTO load_events (load_id,event_type,source,location,metadata)
       VALUES ($1,$2,'DRIVER',CASE WHEN $3::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$3),4326)::geography END,$5::jsonb)`,
      [tracking.load_id, recordedType, lat, lon, JSON.stringify({ ...(etaAt ? { etaAt: etaAt.toISOString() } : {}), trackingTokenUsed: true })]
    );

    if (nextStatus === "DELIVERED" && tracking.truck_id) {
      await client.query(`UPDATE trucks SET status='AVAILABLE',available_at=now() WHERE id=$1`, [tracking.truck_id]);
    }
    await client.query("COMMIT");
    return NextResponse.json({ status: nextStatus, eventType: recordedType, updatedAt: new Date().toISOString() });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record tracking update" }, { status: 400 });
  } finally {
    client.release();
  }
}
