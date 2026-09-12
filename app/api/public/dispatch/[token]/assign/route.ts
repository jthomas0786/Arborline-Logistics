import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const terminalStatuses = new Set(["DELIVERED","POD_RECEIVED","INVOICED","SETTLED","CLOSED","CANCELLED"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await request.json().catch(() => ({}));
  const driverName = typeof body.driverName === "string" ? body.driverName.trim() : "";
  const driverPhone = typeof body.driverPhone === "string" ? body.driverPhone.trim() : "";
  const driverEmail = typeof body.driverEmail === "string" ? body.driverEmail.trim().toLowerCase() : "";
  if (!driverName || driverName.length > 120) return NextResponse.json({ error: "A valid driver name is required" }, { status: 400 });
  if (driverPhone.length > 40) return NextResponse.json({ error: "Driver phone is too long" }, { status: 400 });
  if (driverEmail.length > 320 || (driverEmail && !emailPattern.test(driverEmail))) return NextResponse.json({ error: "Enter a valid driver email address" }, { status: 400 });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT o.load_id,o.carrier_id,o.truck_id,b.id booking_id,b.driver_id,b.tracking_token,
              l.reference_number,l.status load_status
       FROM offers o
       JOIN bookings b ON b.load_id=o.load_id AND b.carrier_id=o.carrier_id
       JOIN loads l ON l.id=o.load_id
       WHERE o.public_token=$1 AND o.status='ACCEPTED'
       FOR UPDATE OF b,l`,
      [token]
    );
    const assignment = rows[0];
    if (!assignment) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Accepted booking not found" }, { status: 404 });
    }
    if (terminalStatuses.has(assignment.load_status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Load cannot be dispatched from ${assignment.load_status}` }, { status: 409 });
    }

    let driverId = assignment.driver_id as string | null;
    if (driverId) {
      const updated = await client.query(
        `UPDATE drivers SET name=$2,phone=$3,email=$4,status='ACTIVE'
         WHERE id=$1 AND carrier_id=$5 RETURNING id`,
        [driverId, driverName, driverPhone || null, driverEmail || null, assignment.carrier_id]
      );
      if (!updated.rows[0]) driverId = null;
    }
    if (!driverId) {
      const created = await client.query(
        `INSERT INTO drivers (carrier_id,name,phone,email,status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
        [assignment.carrier_id, driverName, driverPhone || null, driverEmail || null]
      );
      driverId = created.rows[0].id;
    }

    await client.query(
      `UPDATE bookings
       SET driver_id=$2,dispatched_at=COALESCE(dispatched_at,now()),tracking_started_at=COALESCE(tracking_started_at,now())
       WHERE id=$1`,
      [assignment.booking_id, driverId]
    );
    if (assignment.truck_id) {
      await client.query(`UPDATE trucks SET driver_id=$2,status='DISPATCHED' WHERE id=$1`, [assignment.truck_id, driverId]);
    }
    await client.query(`UPDATE loads SET status=CASE WHEN status='BOOKED' THEN 'DISPATCHED'::load_status ELSE status END WHERE id=$1`, [assignment.load_id]);
    await client.query(
      `INSERT INTO load_events (load_id,event_type,source,metadata)
       VALUES ($1,'DRIVER_ASSIGNED','CARRIER',$2::jsonb)`,
      [assignment.load_id, JSON.stringify({ driverId, driverName, hasPhone: Boolean(driverPhone), hasEmail: Boolean(driverEmail) })]
    );

    const trackingPath = `/driver/loads/${assignment.tracking_token}`;
    const payload = JSON.stringify({
      trackingPath,
      referenceNumber: assignment.reference_number,
      loadReference: assignment.reference_number,
      bookingId: assignment.booking_id
    });
    await client.query(
      `INSERT INTO outbox_messages (load_id,carrier_id,channel,recipient,template,payload)
       VALUES ($1,$2,'PUSH','driver:' || $3::text,'DRIVER_TRACKING',$4::jsonb)`,
      [assignment.load_id, assignment.carrier_id, assignment.booking_id, payload]
    );
    if (driverEmail) {
      await client.query(
        `INSERT INTO outbox_messages (load_id,carrier_id,channel,recipient,template,payload)
         VALUES ($1,$2,'EMAIL',$3,'DRIVER_TRACKING',$4::jsonb)`,
        [assignment.load_id, assignment.carrier_id, driverEmail, payload]
      );
    }
    await client.query("COMMIT");

    const base = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    return NextResponse.json({
      driver: { id: driverId, name: driverName, phone: driverPhone || null, email: driverEmail || null },
      trackingUrl: `${base}${trackingPath}`,
      loadStatus: assignment.load_status === "BOOKED" ? "DISPATCHED" : assignment.load_status
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to assign driver" }, { status: 400 });
  } finally {
    client.release();
  }
}
