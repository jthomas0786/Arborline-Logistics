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
