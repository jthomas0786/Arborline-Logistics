import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getActiveTracking() {
  const { rows } = await getPool().query(
    `SELECT l.id,l.reference_number,l.status,l.origin_city,l.origin_state,l.destination_city,l.destination_state,
            l.pickup_start,l.delivery_start,b.tracking_token,b.dispatched_at,b.last_location_at,b.eta_at,
            ST_Y(b.last_location::geometry) last_lat,ST_X(b.last_location::geometry) last_lon,
            d.name driver_name,d.phone driver_phone,t.unit_number,org.legal_name carrier_name,
            (b.last_location_at IS NULL OR b.last_location_at<now()-interval '90 minutes') AS tracking_stale
     FROM loads l
     JOIN bookings b ON b.load_id=l.id
     JOIN carriers c ON c.id=b.carrier_id
     JOIN organizations org ON org.id=c.organization_id
     LEFT JOIN drivers d ON d.id=b.driver_id
     LEFT JOIN trucks t ON t.id=b.truck_id
     WHERE l.status IN ('BOOKED','DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY')
     ORDER BY l.pickup_start ASC,l.created_at DESC`
  );
  return rows;
}

export default async function TrackingPage() {
  await requirePageRole(["STAFF"]);
  const loads = await getActiveTracking();
  const moving = loads.filter((load) => ["LOADED","IN_TRANSIT","AT_DELIVERY"].includes(load.status)).length;
  const stale = loads.filter((load) => load.tracking_stale && load.status !== "BOOKED").length;
  const awaitingDriver = loads.filter((load) => !load.driver_name).length;

  return <AppShell active="Tracking">
    <header><div><p className="eyebrow">SERVICE VISIBILITY</p><h1>Tracking</h1><p className="muted">Driver assignment, GPS recency, ETA, and shipment status in one queue.</p></div></header>
    <section className="grid stats"><article className="card"><p>Active tracked loads</p><h2>{loads.length}</h2><small>Booked through delivery</small></article><article className="card"><p>Moving</p><h2>{moving}</h2><small>Loaded / in transit</small></article><article className="card"><p>Stale tracking</p><h2>{stale}</h2><small>No GPS within 90 minutes</small></article><article className="card"><p>Awaiting driver</p><h2>{awaitingDriver}</h2><small>Booked but not assigned</small></article></section>
    <section className="panel"><div className="tableWrap"><table><thead><tr><th>Load</th><th>Lane</th><th>Status</th><th>Carrier / Driver</th><th>Unit</th><th>Last GPS</th><th>ETA</th><th>Driver view</th></tr></thead><tbody>{loads.length === 0 ? <tr><td colSpan={8} className="empty">No active booked loads.</td></tr> : loads.map((load) => <tr key={load.id}><td><strong>{load.reference_number}</strong><br/><small className="muted">{new Date(load.pickup_start).toLocaleString()}</small></td><td>{load.origin_city}, {load.origin_state} → {load.destination_city}, {load.destination_state}</td><td><span className={`status ${String(load.status).toLowerCase()}`}>{String(load.status).replaceAll("_"," ")}</span></td><td><strong>{load.carrier_name}</strong><br/><small className="muted">{load.driver_name ?? "Awaiting driver"}{load.driver_phone ? ` · ${load.driver_phone}` : ""}</small></td><td>{load.unit_number ?? "—"}</td><td><span className={load.tracking_stale && load.status !== "BOOKED" ? "formError" : "muted"}>{load.last_location_at ? new Date(load.last_location_at).toLocaleString() : "No ping"}</span></td><td>{load.eta_at ? new Date(load.eta_at).toLocaleString() : "—"}</td><td><a className="tableLink" href={`/driver/loads/${load.tracking_token}`}>Open tracking</a></td></tr>)}</tbody></table></div></section>
  </AppShell>;
}
