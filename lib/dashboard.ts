import { getPool } from "./db";

export interface DashboardSnapshot {
  databaseOnline: boolean;
  activeLoads: number;
  movingNormally: number;
  openExceptions: number;
  grossMarginToday: number;
  noTouchRate: number;
  exceptions: Array<{ id: string; severity: string; reference: string | null; category: string; description: string; createdAt: string }>;
  decisions: Array<{ id: string; reference: string | null; decisionType: string; decision: Record<string, unknown>; createdAt: string }>;
}

const offline: DashboardSnapshot = {
  databaseOnline: false,
  activeLoads: 0,
  movingNormally: 0,
  openExceptions: 0,
  grossMarginToday: 0,
  noTouchRate: 0,
  exceptions: [],
  decisions: []
};

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  try {
    const pool = getPool();
    const [loadStats, exceptionStats, marginStats, decisionStats, exceptions, decisions] = await Promise.all([
      pool.query(`SELECT count(*) FILTER (WHERE status NOT IN ('CLOSED','CANCELLED'))::int active,
                         count(*) FILTER (WHERE status NOT IN ('EXCEPTION','CLOSED','CANCELLED'))::int normal
                  FROM loads`),
      pool.query(`SELECT count(*)::int count FROM exceptions WHERE status='OPEN'`),
      pool.query(`SELECT COALESCE(sum(l.shipper_rate-b.carrier_rate),0)::numeric margin
                  FROM bookings b JOIN loads l ON l.id=b.load_id WHERE b.booked_at::date=current_date`),
      pool.query(`SELECT count(*) FILTER (WHERE decision->>'action'='AUTO_BOOK')::int auto_count,
                         count(*) FILTER (WHERE decision_type='BOOKING_DECISION')::int total_count
                  FROM automation_decisions`),
      pool.query(`SELECT e.id,e.severity,l.reference_number reference,e.category,e.description,e.created_at
                  FROM exceptions e LEFT JOIN loads l ON l.id=e.load_id WHERE e.status='OPEN'
                  ORDER BY e.created_at DESC LIMIT 8`),
      pool.query(`SELECT d.id,l.reference_number reference,d.decision_type,d.decision,d.created_at
                  FROM automation_decisions d LEFT JOIN loads l ON l.id=d.load_id
                  ORDER BY d.created_at DESC LIMIT 8`)
    ]);

    const total = Number(decisionStats.rows[0].total_count ?? 0);
    const auto = Number(decisionStats.rows[0].auto_count ?? 0);
    return {
      databaseOnline: true,
      activeLoads: Number(loadStats.rows[0].active ?? 0),
      movingNormally: Number(loadStats.rows[0].normal ?? 0),
      openExceptions: Number(exceptionStats.rows[0].count ?? 0),
      grossMarginToday: Number(marginStats.rows[0].margin ?? 0),
      noTouchRate: total ? Math.round((auto / total) * 1000) / 10 : 0,
      exceptions: exceptions.rows.map((row) => ({ id: row.id, severity: row.severity, reference: row.reference, category: row.category, description: row.description, createdAt: row.created_at })),
      decisions: decisions.rows.map((row) => ({ id: String(row.id), reference: row.reference, decisionType: row.decision_type, decision: row.decision, createdAt: row.created_at }))
    };
  } catch {
    return offline;
  }
}
