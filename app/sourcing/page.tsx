import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { sourcingConfigured, sourcingProvider } from "@/lib/connect-source-runner";
import { contactEnrichmentConfigured, contactEnrichmentProvider } from "@/lib/connect-contact-enrichment";
import { runContactEnrichment, runSourcing } from "./actions";

export const dynamic = "force-dynamic";

export default async function SourcingPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const [clients, runs] = await Promise.all([
    pool.query(`SELECT c.id,c.company_name,c.status,i.target_industries,i.target_geographies,i.facility_types,i.decision_maker_titles,i.minimum_score FROM connect_clients c JOIN connect_icp_profiles i ON i.client_id=c.id WHERE c.status IN ('READY','ACTIVE','ONBOARDING') ORDER BY c.company_name`),
    pool.query(`SELECT r.id,r.status,r.provider,r.discovered_count,r.inserted_count,r.duplicate_count,r.qualified_count,r.error_message,r.created_at,c.company_name FROM connect_sourcing_runs r JOIN connect_clients c ON c.id=r.client_id ORDER BY r.created_at DESC LIMIT 30`)
  ]);
  const configured = sourcingConfigured();
  const provider = sourcingProvider();
  const enrichmentConfigured = contactEnrichmentConfigured();
  const enrichmentProvider = contactEnrichmentProvider();
  return <AppShell active="Sourcing">
    <header><div><p className="eyebrow">AUTOMATIC DISCOVERY</p><h1>Prospect sourcing</h1><p className="muted">Use a client ICP to discover matching companies, deduplicate them, enforce suppression, score fit, and enrich qualified companies with verified decision-maker contacts.</p></div></header>
    {!configured ? <div className="notice">Automatic sourcing is ready for <strong>Apollo</strong>. Add <strong>APOLLO_API_KEY</strong> in production to turn it on. A generic provider can still be used with <strong>PROSPECT_SOURCE_API_URL</strong>. Until a provider is configured, runs safely stop at “Needs provider.”</div> : null}
    {provider === "APOLLO" ? <div className="notice">Your Apollo connection is configured for <strong>company discovery only</strong>. ArborLine saves and scores matched organizations first, then a separate contact-enrichment provider can find a decision-maker and verified work email. No outreach is sent without a contact email.</div> : null}
    {!enrichmentConfigured ? <div className="notice">Contact enrichment is prepared for <strong>Prospeo</strong> now, with <strong>Hunter</strong> reserved as a second provider. Add <strong>PROSPEO_API_KEY</strong> to enable verified decision-maker enrichment while Hunter support is pending.</div> : null}
    <section className="split">
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">RUN SOURCING</p><h3>Find companies from an ICP</h3></div><span className="status">{configured ? `${provider} connected` : "Provider needed"}</span></div>
        <form action={runSourcing} className="form"><label>Client<select name="clientId" required defaultValue=""><option value="" disabled>Select client</option>{clients.rows.map(c => <option key={c.id} value={c.id}>{c.company_name} · score floor {c.minimum_score}</option>)}</select></label><p className="hint">Apollo searches matching organizations using the client’s industry, geography, facility type, and company-size criteria. The default run is capped at 20 organizations to control API credits.</p><button type="submit">Run automatic sourcing</button></form>
      </article>
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">CONTACT ENRICHMENT</p><h3>Find decision-makers</h3></div><span className="status">{enrichmentConfigured ? `${enrichmentProvider} connected` : "Provider needed"}</span></div>
        <form action={runContactEnrichment} className="form"><label>Client<select name="clientId" required defaultValue=""><option value="" disabled>Select client</option>{clients.rows.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label><p className="hint">Enrichment only touches already-qualified, Partial prospects with a company domain. Prospeo searches the ICP’s decision-maker titles, reveals only verified work emails, checks suppression before saving, and caps each run at 20 prospects.</p><button type="submit" disabled={!enrichmentConfigured}>Run contact enrichment</button></form>
      </article>
    </section>
    <section className="panel"><div className="panelHead"><div><p className="eyebrow">PIPELINE</p><h3>What happens automatically</h3></div></div><div className="health"><div><span>Company discovery</span><b>{configured ? provider : "Provider needed"}</b></div><div><span>Duplicate check</span><b>Required</b></div><div><span>Suppression check</span><b>Required</b></div><div><span>ICP scoring</span><b>Automatic</b></div><div><span>Decision-maker enrichment</span><b>{enrichmentConfigured ? enrichmentProvider : "Ready for Prospeo"}</b></div><div><span>Verified work email</span><b>{enrichmentConfigured ? "Verified only" : "Provider needed"}</b></div><div><span>Outreach readiness</span><b>Email required</b></div></div></section>
    <section className="panel"><div className="panelHead"><div><p className="eyebrow">RECENT RUNS</p><h3>Sourcing history</h3></div></div>{runs.rows.length ? <div className="tableWrap"><table><thead><tr><th>Client</th><th>Provider</th><th>Status</th><th>Discovered</th><th>Inserted</th><th>Duplicates</th><th>Qualified</th><th>Time</th></tr></thead><tbody>{runs.rows.map(r => <tr key={r.id}><td><strong>{r.company_name}</strong>{r.error_message ? <div className="muted">{r.error_message}</div> : null}</td><td>{r.provider}</td><td><span className="status">{r.status}</span></td><td>{r.discovered_count}</td><td>{r.inserted_count}</td><td>{r.duplicate_count}</td><td>{r.qualified_count}</td><td>{new Date(r.created_at).toLocaleString("en-US")}</td></tr>)}</tbody></table></div> : <div className="empty">No sourcing runs yet.</div>}</section>
  </AppShell>;
}
