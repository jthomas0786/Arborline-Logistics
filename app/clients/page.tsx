import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { startClientOnboarding } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const [clientsResult, pilotResult] = await Promise.all([
    pool.query(`
      SELECT c.id,c.company_name,c.industry,c.service_area,c.status,c.booking_type,c.updated_at,
             i.minimum_score,
             cardinality(i.target_industries) AS industry_count,
             cardinality(i.target_geographies) AS geography_count
      FROM connect_clients c
      LEFT JOIN connect_icp_profiles i ON i.client_id=c.id
      ORDER BY c.updated_at DESC
      LIMIT 100
    `),
    pool.query(`
      SELECT p.id,p.name,p.work_email,p.company_name,p.industry,p.service_area,p.website,p.notes,p.created_at
      FROM connect_pilot_interest p
      LEFT JOIN connect_clients c ON c.pilot_interest_id=p.id
      WHERE c.id IS NULL AND p.status IN ('NEW','CONTACTED','QUALIFIED')
      ORDER BY p.created_at DESC
      LIMIT 25
    `)
  ]);

  const activeCount = clientsResult.rows.filter((row) => row.status === "ACTIVE").length;
  const readyCount = clientsResult.rows.filter((row) => row.status === "READY").length;

  return (
    <AppShell active="Clients">
      <header>
        <div>
          <p className="eyebrow">CUSTOMER RULES</p>
          <h1>Clients</h1>
          <p className="muted">Turn pilot interest into a configured ideal-customer profile before any campaign starts.</p>
        </div>
      </header>

      <section className="grid stats">
        <article className="card"><p>Configured clients</p><h2>{clientsResult.rows.length}</h2><small>Onboarding + live accounts</small></article>
        <article className="card"><p>Ready to source</p><h2>{readyCount}</h2><small>ICP approved for prospecting</small></article>
        <article className="card"><p>Active</p><h2>{activeCount}</h2><small>Campaign-capable accounts</small></article>
        <article className="card"><p>Pilot queue</p><h2>{pilotResult.rows.length}</h2><small>Unconverted inbound interest</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">CLIENT WORKSPACE</p><h3>Configured accounts</h3></div>
        </div>
        {clientsResult.rows.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Client</th><th>Industry</th><th>Service area</th><th>ICP</th><th>Score floor</th><th>Status</th><th /></tr></thead>
              <tbody>
                {clientsResult.rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.company_name}</strong></td>
                    <td>{row.industry || "—"}</td>
                    <td>{row.service_area || "—"}</td>
                    <td>{Number(row.industry_count || 0)} industries · {Number(row.geography_count || 0)} markets</td>
                    <td>{row.minimum_score ?? 70}/100</td>
                    <td><span className="status">{row.status}</span></td>
                    <td><a className="tableLink" href={`/clients/${row.id}`}>Configure</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No Connect clients yet. Promote a pilot request or add one manually below.</div>}
      </section>

      <section className="split">
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">PILOT INBOX</p><h3>Start onboarding from interest</h3></div></div>
          {pilotResult.rows.length ? pilotResult.rows.map((pilot) => (
            <div className="exception" key={pilot.id}>
              <div className="grow">
                <strong>{pilot.company_name}</strong>
                <p>{pilot.name} · {pilot.work_email}{pilot.industry ? ` · ${pilot.industry}` : ""}</p>
                <p>{pilot.service_area || "Service area not supplied"}</p>
              </div>
              <form action={startClientOnboarding}>
                <input type="hidden" name="pilotInterestId" value={pilot.id} />
                <input type="hidden" name="companyName" value={pilot.company_name} />
                <input type="hidden" name="primaryContactName" value={pilot.name} />
                <input type="hidden" name="primaryContactEmail" value={pilot.work_email} />
                <input type="hidden" name="industry" value={pilot.industry || ""} />
                <input type="hidden" name="serviceArea" value={pilot.service_area || ""} />
                <input type="hidden" name="website" value={pilot.website || ""} />
                <input type="hidden" name="serviceSummary" value={pilot.notes || ""} />
                <button type="submit">Onboard</button>
              </form>
            </div>
          )) : <div className="empty">No unconverted pilot requests.</div>}
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">MANUAL CLIENT</p><h3>Add an account</h3></div></div>
          <form action={startClientOnboarding} className="form">
            <div className="formGrid">
              <label>Company<input name="companyName" required maxLength={180} /></label>
              <label>Industry<input name="industry" maxLength={120} placeholder="Commercial cleaning" /></label>
              <label>Contact name<input name="primaryContactName" maxLength={120} /></label>
              <label>Contact email<input name="primaryContactEmail" type="email" maxLength={200} /></label>
              <label>Service area<input name="serviceArea" maxLength={180} placeholder="Chicago metro" /></label>
              <label>Website<input name="website" type="url" maxLength={300} placeholder="https://" /></label>
            </div>
            <label>What they sell<textarea name="serviceSummary" rows={4} maxLength={1200} placeholder="Recurring commercial cleaning for offices, medical facilities, and multi-site operators." /></label>
            <button type="submit" style={{ marginTop: 14 }}>Start onboarding</button>
          </form>
        </article>
      </section>
    </AppShell>
  );
}
