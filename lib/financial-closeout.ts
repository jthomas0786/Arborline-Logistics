import type { PoolClient } from "pg";

export async function advanceFinancialCloseout(client: PoolClient, loadId: string, actorUserId: string | null) {
  const { rows } = await client.query(
    `SELECT l.status,
            i.status invoice_status,
            p.status payable_status,
            EXISTS (
              SELECT 1 FROM exceptions e
              WHERE e.load_id=l.id AND e.status IN ('OPEN','ACKNOWLEDGED')
            ) has_open_exception
     FROM loads l
     JOIN shipper_invoices i ON i.load_id=l.id
     JOIN carrier_payables p ON p.load_id=l.id
     WHERE l.id=$1
     FOR UPDATE OF l,i,p`,
    [loadId]
  );
  const state = rows[0];
  if (!state) return { status: null, settled: false, closed: false, hasOpenException: false };
  if (state.invoice_status !== "PAID" || state.payable_status !== "PAID") {
    return { status: state.status as string, settled: false, closed: false, hasOpenException: Boolean(state.has_open_exception) };
  }

  let status = state.status as string;
  let settled = false;
  let closed = false;

  if (status === "INVOICED") {
    await client.query(`UPDATE loads SET status='SETTLED' WHERE id=$1`, [loadId]);
    await client.query(
      `INSERT INTO financial_events (load_id,event_type,direction,is_test,actor_user_id)
       VALUES ($1,'LOAD_SETTLED','SYSTEM',true,$2)`,
      [loadId, actorUserId]
    );
    await client.query(
      `INSERT INTO load_events (load_id,event_type,source,metadata)
       VALUES ($1,'SETTLED','SYSTEM',$2::jsonb)`,
      [loadId, JSON.stringify({ reason: "shipper_and_carrier_paid", testMode: true })]
    );
    status = "SETTLED";
    settled = true;
  }

  if (status === "SETTLED" && !state.has_open_exception) {
    await client.query(`UPDATE loads SET status='CLOSED',closed_at=COALESCE(closed_at,now()) WHERE id=$1`, [loadId]);
    await client.query(
      `INSERT INTO financial_events (load_id,event_type,direction,is_test,actor_user_id)
       VALUES ($1,'LOAD_CLOSED','SYSTEM',true,$2)`,
      [loadId, actorUserId]
    );
    await client.query(
      `INSERT INTO load_events (load_id,event_type,source,metadata)
       VALUES ($1,'CLOSED','SYSTEM',$2::jsonb)`,
      [loadId, JSON.stringify({ reason: "financially_settled_no_open_exceptions", testMode: true })]
    );
    status = "CLOSED";
    closed = true;
  }

  return { status, settled, closed, hasOpenException: Boolean(state.has_open_exception) };
}
