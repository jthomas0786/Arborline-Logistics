import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { CarrierInviteForm } from "./carrier-invite-form";
import { VerifyCarrierButton } from "./verify-button";

export const dynamic = "force-dynamic";

async function getCarriers() {
  const { rows } = await getPool().query(
    `SELECT c.id,o.legal_name,c.usdot_number,c.mc_number,c.onboarding_status,
            c.authority_status,c.insurance_status,c.fraud_score,c.performance_score,
            c.last_verified_at,c.verification_expires_at,c.dispatch_phone,c.dispatch_email,
            c.verification_source,c.fmcsa_allow_to_operate,c.fmcsa_out_of_service,c.fmcsa_out_of_service_date,
            c.fmcsa_snapshot_at,c.insurance_verified_at,c.insurance_expires_at,c.compliance_hold_reason,c.is_test_carrier,
            COALESCE((SELECT string_agg(e.equipment_type, ', ' ORDER BY e.equipment_type) FROM carrier_equipment_profiles e WHERE e.carrier_id=c.id),'') equipment,
            (SELECT count(*)::int FROM trucks t WHERE t.carrier_id=c.id) truck_count,
            (SELECT v.status FROM carrier_verification_checks v WHERE v.carrier_id=c.id ORDER BY v.created_at DESC LIMIT 1) verification_status,
            (SELECT v.last_error FROM carrier_verification_checks v WHERE v.carrier_id=c.id ORDER BY v.created_at DESC LIMIT 1) verification_error,
            (SELECT count(*)::int FROM exceptions x WHERE x.carrier_id=c.id AND x.status='OPEN') open_compliance_exceptions
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
  const fmcsaConfigured = Boolean(process.env.FMCSA_WEB_KEY?.trim());
  const insuranceConfigured = Boolean(process.env.CARRIER_INSURANCE_VERIFICATION_URL?.trim() || process.env.CARRIER_VERIFICATION_WEBHOOK_URL?.trim());

  return <AppShell active="Carriers">
    <header><div><p className="eyebrow">CAPACITY NETWORK</p><h1>Carriers</h1><p className="muted">Production carriers must pass FMCSA identity/operating checks and independent insurance verification before Autopilot can offer or book freight.</p></div></header>
    <section className="grid stats">
      <article className="card"><p>Verified</p><h2>{counts.VERIFIED ?? 0}</h2><small>Fresh compliance + available equipment required</small></article>
      <article className="card"><p>Needs review</p><h2>{(counts.REVIEW ?? 0) + (counts.VERIFICATION_PENDING ?? 0) + (counts.PENDING ?? 0)}</h2><small>Not eligible for production freight</small></article>
      <article className="card"><p>FMCSA API</p><h2>{fmcsaConfigured ? "READY" : "SETUP"}</h2><small>{fmcsaConfigured ? "Official QCMobile WebKey configured" : "FMCSA_WEB_KEY required"}</small></article>
      <article className="card"><p>Insurance verifier</p><h2>{insuranceConfigured ? "READY" : "SETUP"}</h2><small>{insuranceConfigured ? "Independent policy verification configured" : "Provider endpoint required"}</small></article>
    </section>
    <CarrierInviteForm/>
    <section className="panel" style={{marginTop:12}}><div className="tableWrap"><table><thead><tr><th>Carrier</th><th>USDOT / MC</th><th>Status</th><th>Authority</th><th>Insurance</th><th>Compliance source</th><th>Verification</th><th>Equipment</th><th>Risk</th><th>Action</th></tr></thead><tbody>
      {carriers.length === 0 ? <tr><td colSpan={10} className="empty">No carriers registered yet.</td></tr> : carriers.map((carrier) => {
        const expiry = carrier.verification_expires_at ? new Date(carrier.verification_expires_at) : null;
        const fresh = expiry ? expiry.getTime() > Date.now() : false;
        const insuranceExpiry = carrier.insurance_expires_at ? new Date(carrier.insurance_expires_at) : null;
        return <tr key={carrier.id}>
          <td><strong>{carrier.legal_name}</strong>{carrier.is_test_carrier && <><br/><span className="status review">TEST ONLY</span></>}<br/><small className="muted">{carrier.dispatch_email || carrier.dispatch_phone || "No dispatch contact"}</small></td>
          <td>USDOT {carrier.usdot_number ?? "—"}<br/>MC {carrier.mc_number ?? "—"}</td>
          <td><span className={`status ${String(carrier.onboarding_status).toLowerCase()}`}>{carrier.onboarding_status}</span>{Number(carrier.open_compliance_exceptions) > 0 && <><br/><small className="formError">{carrier.open_compliance_exceptions} open compliance exception(s)</small></>}</td>
          <td>{carrier.authority_status}<br/><small className="muted">{carrier.fmcsa_out_of_service ? `OOS${carrier.fmcsa_out_of_service_date ? ` since ${carrier.fmcsa_out_of_service_date}` : ""}` : carrier.fmcsa_allow_to_operate === true ? "Allowed to operate" : carrier.is_test_carrier ? "Synthetic test status" : "Awaiting FMCSA"}</small></td>
          <td>{carrier.insurance_status}<br/><small className="muted">{insuranceExpiry ? `Expires ${insuranceExpiry.toLocaleDateString()}` : carrier.insurance_verified_at ? "Verified; no expiry returned" : carrier.is_test_carrier ? "Synthetic test status" : "Awaiting provider"}</small></td>
          <td>{carrier.verification_source ?? "—"}<br/><small className="muted">{carrier.fmcsa_snapshot_at ? `FMCSA ${new Date(carrier.fmcsa_snapshot_at).toLocaleString()}` : "No FMCSA snapshot"}</small></td>
          <td>{carrier.verification_status ?? "—"}<br/><small className={fresh ? "muted" : "formError"}>{expiry ? `${fresh ? "Fresh until" : "Expired"} ${expiry.toLocaleString()}` : "No active verification"}</small>{carrier.compliance_hold_reason && <><br/><small className="formError">{carrier.compliance_hold_reason}</small></>}{carrier.verification_error && <><br/><small className="muted">{carrier.verification_error}</small></>}</td>
          <td>{String(carrier.equipment || "—").replaceAll("_"," ")}<br/><small className="muted">{carrier.truck_count} truck(s)</small></td>
          <td>{carrier.fraud_score}/100</td>
          <td><VerifyCarrierButton carrierId={carrier.id} disabled={carrier.is_test_carrier}/></td>
        </tr>;
      })}
    </tbody></table></div></section>
  </AppShell>;
}
