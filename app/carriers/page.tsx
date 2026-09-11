import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { CarrierInviteForm } from "./carrier-invite-form";

export const dynamic = "force-dynamic";

async function getCarriers() {
  const { rows } = await getPool().query(
    `SELECT c.id,o.legal_name,c.usdot_number,c.mc_number,c.onboarding_status,
            c.authority_status,c.insurance_status,c.fraud_score,c.performance_score,
            c.last_verified_at,c.verification_expires_at,c.dispatch_phone,c.dispatch_email,
            COALESCE((SELECT string_agg(e.equipment_type, ', ' ORDER BY e.equipment_type) FROM carrier_equipment_profiles e WHERE e.carrier_id=c.id),'') equipment,
            (SELECT count(*)::int FROM trucks t WHERE t.carrier_id=c.id) truck_count,
            (SELECT v.status FROM carrier_verification_checks v WHERE v.carrier_id=c.id ORDER BY v.created_at DESC LIMIT 1) verification_status
     FROM carriers c
     JOIN organizations o ON o.id=c.organization_id
     ORDER BY CASE c.onboarding_status WHEN 'REVIEW' THEN 0 WHEN 'VERIFICATION_PENDING' THEN 1 WHEN 'PENDING' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END,
              o.legal_name`
  );
  return rows;
}

export default async function CarriersPage() {
  await requirePageRole(["STAFF"]);
  const carriers = await getCarriers();
  const counts = carriers.reduce((acc: Record<string, number>, carrier) => {
    acc[carrier.onboarding_status] = (acc[carrier.onboarding_status] ?? 0) + 1;
    return acc;
  }, {});

  return <AppShell active="Carriers"><header><div><p className="eyebrow">CAPACITY NETWORK</p><h1>Carriers</h1><p className="muted">Only carriers with fresh VERIFIED status can receive Autopilot offers.</p></div></header><section className="grid stats"><article className="card"><p>Verified</p><h2>{counts.VERIFIED ?? 0}</h2><small>Eligible when truck is available</small></article><article className="card"><p>Pending verification</p><h2>{(counts.VERIFICATION_PENDING ?? 0) + (counts.PENDING ?? 0)}</h2><small>Not eligible for freight</small></article><article className="card"><p>Needs review</p><h2>{counts.REVIEW ?? 0}</h2><small>Human exception</small></article><article className="card"><p>Total carriers</p><h2>{carriers.length}</h2><small>Registered network</small></article></section><CarrierInviteForm/><section className="panel" style={{marginTop:12}}><div className="tableWrap"><table><thead><tr><th>Carrier</th><th>USDOT / MC</th><th>Status</th><th>Authority</th><th>Insurance</th><th>Verification</th><th>Equipment</th><th>Trucks</th><th>Risk</th></tr></thead><tbody>{carriers.length === 0 ? <tr><td colSpan={9} className="empty">No carriers registered yet.</td></tr> : carriers.map((carrier) => { const expiry = carrier.verification_expires_at ? new Date(carrier.verification_expires_at) : null; const fresh = expiry ? expiry.getTime() > Date.now() : false; return <tr key={carrier.id}><td><strong>{carrier.legal_name}</strong><br/><small className="muted">{carrier.dispatch_email || carrier.dispatch_phone || "No dispatch contact"}</small></td><td>USDOT {carrier.usdot_number ?? "—"}<br/>MC {carrier.mc_number ?? "—"}</td><td><span className={`status ${String(carrier.onboarding_status).toLowerCase()}`}>{carrier.onboarding_status}</span></td><td>{carrier.authority_status}</td><td>{carrier.insurance_status}</td><td>{carrier.verification_status ?? "—"}<br/><small className={fresh ? "muted" : "formError"}>{expiry ? `${fresh ? "Fresh until" : "Expired"} ${expiry.toLocaleString()}` : "No active verification"}</small></td><td>{String(carrier.equipment || "—").replaceAll("_"," ")}</td><td>{carrier.truck_count}</td><td>{carrier.fraud_score}/100</td></tr>; })}</tbody></table></div></section></AppShell>;
}
