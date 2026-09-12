import { notFound } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { updateClientProfile } from "../actions";

export const dynamic = "force-dynamic";

function joinList(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "";
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const pool = getPool();
  const [clientResult, rulesResult] = await Promise.all([
    pool.query(`
      SELECT c.*,
             i.target_industries,i.target_geographies,i.min_employees,i.max_employees,
             i.min_locations,i.max_locations,i.facility_types,i.decision_maker_titles,
             i.buying_signals,i.exclusions,i.qualification_notes,i.minimum_score
      FROM connect_clients c
      LEFT JOIN connect_icp_profiles i ON i.client_id=c.id
      WHERE c.id=$1
      LIMIT 1
    `, [id]),
    pool.query(`
      SELECT id,category,rule_type,label,description,weight,is_active
      FROM connect_qualification_rules
      WHERE client_id=$1
      ORDER BY sort_order,label
    `, [id])
  ]);

  const client = clientResult.rows[0];
  if (!client) notFound();

  return (
    <AppShell active="Clients">
      <header>
        <div>
          <p className="eyebrow">CLIENT ONBOARDING</p>
          <h1>{client.company_name}</h1>
          <p className="muted">Define the target account, decision maker, buying signals, exclusions, and handoff standard before sourcing begins.</p>
        </div>
        <a className="button" href="/clients">Back to clients</a>
      </header>

      <section className="grid stats">
        <article className="card"><p>Status</p><h2>{client.status}</h2><small>Controls campaign readiness</small></article>
        <article className="card"><p>Qualification floor</p><h2>{client.minimum_score ?? 70}</h2><small>Minimum fit score out of 100</small></article>
        <article className="card"><p>Target industries</p><h2>{client.target_industries?.length ?? 0}</h2><small>Explicit account segments</small></article>
        <article className="card"><p>Rules</p><h2>{rulesResult.rows.filter((rule) => rule.is_active).length}</h2><small>Active qualification checks</small></article>
      </section>

      <form action={updateClientProfile} className="form">
        <input type="hidden" name="clientId" value={client.id} />

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">ACCOUNT</p><h3>Client setup</h3></div></div>
          <div className="formGrid">
            <label>Company<input name="companyName" required maxLength={180} defaultValue={client.company_name} /></label>
            <label>Industry<input name="industry" maxLength={120} defaultValue={client.industry || ""} /></label>
            <label>Primary contact<input name="primaryContactName" maxLength={120} defaultValue={client.primary_contact_name || ""} /></label>
            <label>Contact email<input name="primaryContactEmail" type="email" maxLength={200} defaultValue={client.primary_contact_email || ""} /></label>
            <label>Website<input name="website" type="url" maxLength={300} defaultValue={client.website || ""} /></label>
            <label>Service area<input name="serviceArea" maxLength={180} defaultValue={client.service_area || ""} /></label>
            <label>Status<select name="status" defaultValue={client.status}><option>ONBOARDING</option><option>READY</option><option>ACTIVE</option><option>PAUSED</option><option>CLOSED</option></select></label>
            <label>Appointment type<select name="bookingType" defaultValue={client.booking_type}><option>CALL</option><option>ESTIMATE</option><option>DEMO</option><option>WALKTHROUGH</option><option>OTHER</option></select></label>
            <label>Timezone<input name="timezone" maxLength={100} defaultValue={client.timezone || "America/Chicago"} /></label>
            <label>Minimum qualification score<input name="minimumScore" type="number" min={0} max={100} defaultValue={client.minimum_score ?? 70} /></label>
          </div>
          <label>What this client sells<textarea name="serviceSummary" rows={4} maxLength={1200} defaultValue={client.service_summary || ""} /></label>
        </section>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">IDEAL CUSTOMER PROFILE</p><h3>Who Connect should find</h3></div></div>
          <div className="formGrid">
            <label>Target industries<textarea name="targetIndustries" rows={3} defaultValue={joinList(client.target_industries)} placeholder="Property management, medical offices, manufacturing" /></label>
            <label>Target geographies<textarea name="targetGeographies" rows={3} defaultValue={joinList(client.target_geographies)} placeholder="Chicago, Cook County, DuPage County" /></label>
            <label>Minimum employees<input name="minEmployees" type="number" min={0} defaultValue={client.min_employees ?? ""} /></label>
            <label>Maximum employees<input name="maxEmployees" type="number" min={0} defaultValue={client.max_employees ?? ""} /></label>
            <label>Minimum locations<input name="minLocations" type="number" min={0} defaultValue={client.min_locations ?? ""} /></label>
            <label>Maximum locations<input name="maxLocations" type="number" min={0} defaultValue={client.max_locations ?? ""} /></label>
            <label>Facility / account types<textarea name="facilityTypes" rows={3} defaultValue={joinList(client.facility_types)} placeholder="Office, medical, warehouse, multi-tenant" /></label>
            <label>Decision-maker titles<textarea name="decisionMakerTitles" rows={3} defaultValue={joinList(client.decision_maker_titles)} placeholder="Facility Manager, Property Manager, Operations Director" /></label>
            <label>Buying signals<textarea name="buyingSignals" rows={3} defaultValue={joinList(client.buying_signals)} placeholder="New location, vendor review, service complaint, contract renewal" /></label>
            <label>Exclusions<textarea name="exclusions" rows={3} defaultValue={joinList(client.exclusions)} placeholder="Residential only, outside service radius, competitors" /></label>
          </div>
          <label>Qualification notes<textarea name="qualificationNotes" rows={5} maxLength={3000} defaultValue={client.qualification_notes || ""} placeholder="Any nuance the qualification engine should preserve before counting an opportunity." /></label>
        </section>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">QUALIFICATION ENGINE</p><h3>Current rule framework</h3></div><span className="badge">Client-specific</span></div>
          {rulesResult.rows.map((rule) => (
            <div className="exception" key={rule.id}>
              <span className={`severity ${rule.rule_type === "REQUIRED" ? "review" : ""}`}>{rule.rule_type}</span>
              <div className="grow"><strong>{rule.label}</strong><p>{rule.description || rule.category}</p></div>
              <strong>{rule.weight > 0 ? `+${rule.weight}` : rule.weight}</strong>
            </div>
          ))}
          {!rulesResult.rows.length && <div className="empty">No qualification rules configured.</div>}
        </section>

        <button type="submit">Save client profile</button>
      </form>
    </AppShell>
  );
}
