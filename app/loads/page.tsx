import { AppShell } from "@/app/components/AppShell";
import { getPool } from "@/lib/db";

async function getLoads() {
  try {
    const { rows } = await getPool().query(`SELECT l.id,l.reference_number,l.status,l.origin_city,l.origin_state,l.destination_city,l.destination_state,l.pickup_start,l.shipper_rate,l.target_carrier_rate,l.created_at,
      (SELECT count(*)::int FROM offers o WHERE o.load_id=l.id) offer_count,
      (SELECT count(*)::int FROM exceptions e WHERE e.load_id=l.id AND e.status='OPEN') exception_count
      FROM loads l ORDER BY l.created_at DESC LIMIT 100`);
    return rows;
  } catch { return []; }
}

export default async function LoadsPage() {
  const loads = await getLoads();
  return <AppShell active="Loads"><header><div><p className="eyebrow">OPERATIONS</p><h1>Loads</h1><p className="muted">Live shipment state, offers, and exceptions.</p></div><a className="button" href="/shipper/new">+ New quote</a></header><section className="panel"><div className="tableWrap"><table><thead><tr><th>Load</th><th>Lane</th><th>Pickup</th><th>Status</th><th>Shipper</th><th>Carrier target</th><th>Offers</th><th>Exceptions</th></tr></thead><tbody>{loads.length === 0 ? <tr><td colSpan={8} className="empty">No loads yet.</td></tr> : loads.map((load) => <tr key={load.id}><td><strong>{load.reference_number}</strong></td><td>{load.origin_city}, {load.origin_state} → {load.destination_city}, {load.destination_state}</td><td>{new Date(load.pickup_start).toLocaleString()}</td><td><span className={`status ${String(load.status).toLowerCase()}`}>{load.status}</span></td><td>{load.shipper_rate ? `$${Number(load.shipper_rate).toLocaleString()}` : "—"}</td><td>{load.target_carrier_rate ? `$${Number(load.target_carrier_rate).toLocaleString()}` : "—"}</td><td>{load.offer_count}</td><td>{load.exception_count}</td></tr>)}</tbody></table></div></section></AppShell>;
}
