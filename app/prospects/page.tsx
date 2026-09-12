import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { addProspect, createOutreachDraft, rescoreProspect, sendOutreachTest, suppressProspect } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const [prospectsResult, clientsResult, draftsResult] = await Promise.all([
    pool.query(`
      SELECT p.id,p.company_name,p.website,p.domain,p.industry,p.city,p.state,p.employee_count,p.location_count,
             p.facility_type,p.contact_name,p.contact_title,p.contact_email,p.source,p.buying_signals,
             p.enrichment_status,p.qualification_status,p.qualification_score,p.qualification_reasons,
             p.outreach_status,p.suppression_status,p.updated_at,
             c.company_name AS client_company,i.minimum_score
      FROM connect_prospects p
      JOIN connect_clients c ON c.id=p.client_id
      LEFT JOIN connect_icp_profiles i ON i.client_id=p.client_id
      ORDER BY p.updated_at DESC
      LIMIT 200
    `),
    pool.query(`
      SELECT c.id,c.company_name,c.status,i.minimum_score
      FROM connect_clients c
      JOIN connect_icp_profiles i ON i.client_id=c.id
      WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
      ORDER BY c.company_name
    `),
    pool.query(`
      SELECT m.id,m.prospect_id,m.subject,m.recipient_email,m.created_at,p.company_name,c.company_name AS client_company
      FROM connect_outreach_messages m
      JOIN connect_prospects p ON p.id=m.prospect_id
      JOIN connect_clients c ON c.id=m.client_id
      WHERE m.status='DRAFT'
      ORDER BY m.created_at DESC
      LIMIT 25
    `)
  ]);

  const prospects = prospectsResult.rows;
  const qualified = prospects.filter((row) => row.qualification_status === "QUALIFIED").length;
  const review = prospects.filter((row) => row.qualification_status === "REVIEW").length;
  const ready = prospects.filter((row) => row.outreach_status === "READY").length;
  const suppressed = prospects.filter((row) => row.qualification_status === "SUPPRESSED").length;

  return (
    <AppShell active="Prospects">
      <header>
        <div>
          <p className="eyebrow">PROSPECT ENGINE V1</p>
          <h1>Prospects</h1>
          <p className="muted">Source target accounts, score them against each client’s ICP, enforce suppression, and prepare controlled ArborLine Connect outreach.</p>
        </div>
      </header>

      <section className="grid stats">
        <article className="card"><p>Total prospects</p><h2>{prospects.length}</h2><small>Across configured clients</small></article>
        <article className="card"><p>Qualified</p><h2>{qualified}</h2><small>At or above each client score floor</small></article>
        <article className="card"><p>Needs review</p><h2>{review}</h2><small>Close fit with missing enrichment</small></article>
        <article className="card"><p>Ready for outreach</p><h2>{ready}</h2><small>Qualified + contact email + clear suppression</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">QUALIFICATION QUEUE</p><h3>Scored prospects</h3></div>
          <span className="status">{suppressed} suppressed</span>
        </div>
        {prospects.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Prospect</th><th>Client</th><th>Contact</th><th>Fit score</th><th>Qualification</th><th>Outreach</th><th>Actions</th></tr></thead>
              <tbody>
                {prospects.map((row) => {
                  const reasons = Array.isArray(row.qualification_reasons) ? row.qualification_reasons : [];
                  const matched = reasons.filter((reason: { matched?: boolean }) => reason.matched).length;
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.company_name}</strong>
                        <div className="muted">{row.industry || "Industry unknown"}{row.city || row.state ? ` · ${[row.city,row.state].filter(Boolean).join(", ")}` : ""}</div>
                        <div className="muted">{row.source || "Unknown source"}{row.domain ? ` · ${row.domain}` : ""}</div>
                      </td>
                      <td>{row.client_company}</td>
                      <td>
                        {row.contact_name || "—"}
                        <div className="muted">{row.contact_title || "Title unknown"}</div>
                        <div className="muted">{row.contact_email || "Email missing"}</div>
                      </td>
                      <td><strong>{row.qualification_score ?? 0}/100</strong><div className="muted">{matched}/{reasons.length || 0} checks matched · floor {row.minimum_score ?? 70}</div></td>
                      <td><span className="status">{row.qualification_status}</span></td>
                      <td><span className="status">{row.outreach_status}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <form action={rescoreProspect}><input type="hidden" name="prospectId" value={row.id} /><button type="submit" className="secondary">Rescore</button></form>
                          {row.qualification_status === "QUALIFIED" && row.outreach_status === "READY" ? (
                            <form action={createOutreachDraft}><input type="hidden" name="prospectId" value={row.id} /><button type="submit">Draft email</button></form>
                          ) : null}
                          {row.qualification_status !== "SUPPRESSED" ? (
                            <form action={suppressProspect}><input type="hidden" name="prospectId" value={row.id} /><button type="submit" className="secondary">Suppress</button></form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No prospects yet. Add the first target account below.</div>}
      </section>

      <section className="split">
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">MANUAL SOURCE</p><h3>Add a prospect</h3></div></div>
          <form action={addProspect} className="form">
            <div className="formGrid">
              <label>Client<select name="clientId" required defaultValue=""><option value="" disabled>Select client</option>{clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name} · floor {client.minimum_score}</option>)}</select></label>
              <label>Company<input name="companyName" required maxLength={180} /></label>
              <label>Website<input name="website" maxLength={300} placeholder="https://example.com" /></label>
              <label>Industry<input name="industry" maxLength={120} placeholder="Medical office" /></label>
              <label>City<input name="city" maxLength={120} /></label>
              <label>State<input name="state" maxLength={80} /></label>
              <label>Employees<input name="employeeCount" type="number" min="0" /></label>
              <label>Locations<input name="locationCount" type="number" min="0" /></label>
              <label>Facility type<input name="facilityType" maxLength={120} placeholder="Medical office" /></label>
              <label>Contact name<input name="contactName" maxLength={120} /></label>
              <label>Contact title<input name="contactTitle" maxLength={160} placeholder="Office Manager" /></label>
              <label>Contact email<input name="contactEmail" type="email" maxLength={200} /></label>
              <label>Source<input name="source" maxLength={120} defaultValue="MANUAL" /></label>
              <label>Source URL<input name="sourceUrl" maxLength={500} placeholder="https://" /></label>
            </div>
            <label>Buying signals<textarea name="buyingSignals" rows={3} maxLength={2000} placeholder="New location, vendor review, hiring facilities staff" /></label>
            <button type="submit" style={{ marginTop: 14 }}>Add + score prospect</button>
          </form>
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">CONTROLLED RESEND TEST</p><h3>Outreach drafts</h3></div></div>
          <p className="muted">Drafts use Josh Thomas / ArborLine Connect. Test sends go only to the test address entered here — never to the prospect.</p>
          {draftsResult.rows.length ? draftsResult.rows.map((draft) => (
            <div className="exception" key={draft.id}>
              <div className="grow">
                <strong>{draft.company_name}</strong>
                <p>{draft.client_company} · {draft.subject}</p>
                <p>Intended recipient: {draft.recipient_email}</p>
              </div>
              <form action={sendOutreachTest} className="form" style={{ minWidth: 240 }}>
                <input type="hidden" name="messageId" value={draft.id} />
                <label>Test recipient<input name="testRecipient" type="email" required placeholder="you@yourdomain.com" /></label>
                <button type="submit">Send test</button>
              </form>
            </div>
          )) : <div className="empty">No outreach drafts yet. Qualified prospects with a clear email can generate one.</div>}
        </article>
      </section>
    </AppShell>
  );
}
