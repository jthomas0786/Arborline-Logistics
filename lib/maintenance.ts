import { getPool } from "./db";
import { runAutopilot } from "./workflow";

export async function expireAndRecoverOffers() {
  const pool = getPool();
  const expired = await pool.query(
    `UPDATE offers SET status='EXPIRED'
     WHERE status IN ('PENDING','OPENED','COUNTERED')
       AND expires_at IS NOT NULL AND expires_at<=now()
     RETURNING load_id`
  );

  const loadIds = [...new Set(expired.rows.map((row) => String(row.load_id)))];
  const recoveries: Array<{ loadId: string; status: string; reason?: string }> = [];

  for (const loadId of loadIds) {
    const { rows } = await pool.query(
      `SELECT l.status,
              (SELECT count(*)::int FROM offers o WHERE o.load_id=l.id AND o.status IN ('PENDING','OPENED','COUNTERED') AND (o.expires_at IS NULL OR o.expires_at>now())) active_offers
       FROM loads l WHERE l.id=$1`,
      [loadId]
    );
    if (!rows[0] || rows[0].status === "BOOKED" || Number(rows[0].active_offers) > 0) continue;

    try {
      const result = await runAutopilot(loadId);
      recoveries.push({ loadId, status: result.status, reason: result.reason });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown recovery error";
      await pool.query(
        `INSERT INTO exceptions (load_id,severity,category,description,recommended_action)
         VALUES ($1,'HIGH','AUTOMATION_RECOVERY',$2,'Review the load and rerun Autopilot after correcting the failure.')`,
        [loadId, reason]
      );
      recoveries.push({ loadId, status: "EXCEPTION", reason });
    }
  }

  return { expiredOffers: expired.rowCount ?? 0, recoveredLoads: recoveries.length, recoveries };
}

export async function monitorTrackingHealth(staleMinutes = 90) {
  const pool = getPool();
  const minutes = Math.max(30, Math.min(360, Number.isFinite(staleMinutes) ? staleMinutes : 90));

  const opened = await pool.query(
    `INSERT INTO exceptions (load_id,severity,category,description,recommended_action)
     SELECT l.id,'REVIEW','TRACKING_STALE',
            'No fresh driver GPS update has been received within the tracking threshold.',
            'Contact the carrier or driver and restore shipment tracking.'
     FROM loads l
     JOIN bookings b ON b.load_id=l.id
     WHERE l.status IN ('DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY')
       AND b.driver_id IS NOT NULL
       AND COALESCE(b.last_location_at,b.dispatched_at,b.booked_at) <= now()-($1 * interval '1 minute')
       AND NOT EXISTS (
         SELECT 1 FROM exceptions e
         WHERE e.load_id=l.id AND e.category='TRACKING_STALE' AND e.status='OPEN'
       )
     RETURNING load_id`,
    [minutes]
  );

  const resolved = await pool.query(
    `UPDATE exceptions e SET status='RESOLVED',resolved_at=now()
     WHERE e.category='TRACKING_STALE' AND e.status='OPEN'
       AND EXISTS (
         SELECT 1 FROM loads l JOIN bookings b ON b.load_id=l.id
         WHERE l.id=e.load_id
           AND (
             l.status IN ('DELIVERED','POD_RECEIVED','INVOICED','SETTLED','CLOSED','CANCELLED')
             OR b.last_location_at > now()-($1 * interval '1 minute')
           )
       )
     RETURNING e.load_id`,
    [minutes]
  );

  return { staleMinutes: minutes, opened: opened.rowCount ?? 0, resolved: resolved.rowCount ?? 0 };
}

export async function monitorBillingHealth() {
  const pool = getPool();
  const opened = await pool.query(
    `INSERT INTO exceptions (load_id,severity,category,description,recommended_action)
     SELECT i.load_id,'HIGH','AR_OVERDUE',
            'Shipper invoice is past due and remains unpaid.',
            'Review the shipper account and begin the approved collections workflow.'
     FROM shipper_invoices i
     WHERE i.status='ISSUED' AND i.due_at<now()
       AND NOT EXISTS (
         SELECT 1 FROM exceptions e
         WHERE e.load_id=i.load_id AND e.category='AR_OVERDUE' AND e.status IN ('OPEN','ACKNOWLEDGED')
       )
     RETURNING load_id`
  );

  const resolved = await pool.query(
    `UPDATE exceptions e SET status='RESOLVED',resolved_at=now()
     WHERE e.category='AR_OVERDUE' AND e.status IN ('OPEN','ACKNOWLEDGED')
       AND EXISTS (
         SELECT 1 FROM shipper_invoices i
         WHERE i.load_id=e.load_id AND (i.status<>'ISSUED' OR i.due_at>=now())
       )
     RETURNING load_id`
  );

  return { overdueOpened: opened.rowCount ?? 0, overdueResolved: resolved.rowCount ?? 0 };
}
