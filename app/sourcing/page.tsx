import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { sourcingConfigured, sourcingProvider } from "@/lib/connect-source-runner";
import { contactEnrichmentConfigured, contactEnrichmentProvider } from "@/lib/connect-contact-enrichment";
import { approveProspectSegment, runContactEnrichment, runSourcing } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).join(" · ") : "";
}

export default async function SourcingPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const enrichStatus = valueOf(params.enrich);
  const segmentStatus = valueOf(params.segment);
  const attempted = valueOf(params.attempted) ?? "0";
  const enriched = valueOf(params.enriched) ?? "0";
  const suppressed = valueOf(params.suppressed) ?? "0";

  const pool = getPool();
  const [clients, segments, runs] = await Promise.all([
    pool.query(`SELECT c.id,c.company_name,c.status,i.target_industries,i.target_geographies,i.facility_types,i.decision_maker_titles,i.minimum_score
      FROM connect_clients c
      JOIN connect_icp_profiles i ON i.client_id=c.id
      WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
      ORDER BY c.company_name`),
    pool.query(`SELECT s.id,s.client_id,s.slug,s.name,s.service_vertical,s.status,s.target_industries,s.target_geographies,
      s.min_employees,s.max_employees,s.facility_types,s.decision_maker_titles,s.minimum_score,s.qualification_notes,s.approved_at,
      c.company_name,
      count(p.id)::int AS prospect_count,
      count(p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified_count,
      count(p.id) FILTER (WHERE p.outreach_status='READY')::int AS ready_count,
      count(p.id) FILTER (WHERE p.outreach_status='CONTACTED')::int AS contacted_count
      FROM connect_prospect_segments s
      JOIN connect_clients c ON c.id=s.client_id
      LEFT JOIN connect_prospects p ON p.segment_id=s.id
      WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
      GROUP BY s.id,c.company_name
      ORDER BY c.company_name,s.name`),
    pool.query(`SELECT r.id,r.status,r.provider,r.discovered_count,r.inserted_count,r.duplicate_count,r.qualified_count,r.error_message,r.created_at,
      c.company_name,s.name AS segment_name
      FROM connect_sourcing_runs r
      JOIN connect_clients c ON c.id=r.client_id
      LEFT JOIN connect_prospect_segments s ON s.id=r.segment_id
      ORDER BY r.created_at DESC LIMIT 30`)
  ]);
  const configured = sourcingConfigured();
  const provider = sourcingProvider();
  const enrichmentConfigured = contactEnrichmentConfigured();
  const enrichmentProvider = contactEnrichmentProvider();
  const runnableSegments = segments.rows.filter(segment => segment.status === "APPROVED" || segment.status === "ACTIVE");

  let enrichmentNotice: React.ReactNode = null;
  if (enrichStatus === "completed") {
    enrichmentNotice = <div className="notice"><strong>Contact enrichment completed.</strong> Attempted {attempted} qualified prospects, enriched {enriched} with verified work emails, and suppressed {suppressed}. No outreach was sent.</div>;
  } else if (enrichStatus === "failed") {
    enrichmentNotice = <div className="notice"><strong>Contact enrichment failed.</strong> No outreach was sent. Check the provider/API status and try again.</div>;
  } else if (enrichStatus === "profile_required") {
    enrichmentNotice = <div className="notice"><strong>Select a sourcing profile</strong> before running contact enrichment.</div>;
  } else if (enrichStatus === "needs_provider") {
    enrichmentNotice = <div className="notice"><strong>Contact enrichment provider required.</strong> Add a supported provider API key before running enrichment.</div>;
  } else if (enrichStatus === "hunter_pending") {
    enrichmentNotice = <div className="notice"><strong>Hunter enrichment is not enabled yet.</strong> Prospeo is the active supported enrichment path.</div>;
  }

  return <AppShell active="Sourcing">
    <header><div><p className="eyebrow">AUTOMATIC DISCOVERY</p><h1>Prospect sourcing</h1><p className="muted">Keep each market separate. Use the original client ICP or an approved industry campaign to discover, qualify, and enrich a dedicated prospect pool.</p></div></header>
    {!configured ? <div className="notice">Automatic sourcing is ready for <strong>Apollo</strong>. Add <strong>APOLLO_API_KEY</strong> in production to turn it on. A generic provider can still be used with <strong>PROSPECT_SOURCE_API_URL</strong>. Until a provider is configured, runs safely stop at “Needs provider.”</div> : null}
    {provider === "APOLLO" ? <div className="notice">Apollo is configured for <strong>company discovery only</strong>. Each approved industry campaign keeps its own target profile and prospect pool. Company discovery never sends outreach.</div> : null}
    {!enrichmentConfigured ? <div className="notice">Contact enrichment is prepared for <strong>Prospeo</strong> now, with <strong>Hunter</strong> reserved as a second provider. Add <strong>PROSPEO_API_KEY</strong> to enable verified decision-maker enrichment while Hunter support is pending.</div> : null}
    {segmentStatus === "approved" ? <div className="notice"><strong>Industry campaign approved.</strong> It is now available in the sourcing and enrichment selectors. Approval itself did not use provider credits or send outreach.</div> : null}
    {segmentStatus === "unchanged" ? <div className="notice"><strong>Industry campaign was not changed.</strong> It may already be approved or no longer be a draft.</div> : null}
    {enrichmentNotice}

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">INDUSTRY CAMPAIGNS</p><h3>Separate target profiles for ArborLine growth</h3></div><span className="status">{segments.rows.length} configured</span></div>
      <p className="muted">Draft campaigns are review-only. They cannot call Apollo or Prospeo until a staff approval explicitly unlocks them.</p>
      <div style={{display:"grid",gap:10,marginTop:12}}>{segments.rows.length ? segments.rows.map(segment => <article className="exception" key={segment.id} style={{alignItems:"flex-start"}}>
        <span className={`severity ${segment.status === "DRAFT" ? "review" : "docs"}`}>{segment.status}</span>
        <div className="grow">
          <strong>{segment.name}</strong>
          <p>{segment.company_name} · {segment.service_vertical} · score floor {segment.minimum_score}</p>
          <div className="health" style={{marginTop:10}}>
            <div><span>Target industries</span><b>{list(segment.target_industries) || "Needs review"}</b></div>
            <div><span>Geography</span><b>{list(segment.target_geographies) || "Unspecified"}</b></div>
            <div><span>Company size</span><b>{segment.min_employees || "—"}–{segment.max_employees || "—"} employees</b></div>
            <div><span>Prospects</span><b>{segment.prospect_count}</b></div>
            <div><span>Qualified</span><b>{segment.qualified_count}</b></div>
            <div><span>Ready</span><b>{segment.ready_count}</b></div>
            <div><span>Contacted</span><b>{segment.contacted_count}</b></div>
          </div>
          <p><strong>Decision makers:</strong> {list(segment.decision_maker_titles) || "Needs review"}</p>
          {segment.qualification_notes ? <p className="muted">{segment.qualification_notes}</p> : null}
        </div>
        <div>{segment.status === "DRAFT" ? <form action={approveProspectSegment}><input type="hidden" name="segmentId" value={segment.id}/><button type="submit">Approve profile</button></form> : <span className="status">Available to source</span>}</div>
      </article>) : <div className="empty">No industry campaigns configured yet.</div>}</div>
    </section>

    <section className="split">
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">RUN SOURCING</p><h3>Find companies from one profile</h3></div><span className="status">{configured ? `${provider} connected` : "Provider needed"}</span></div>
        <form action={runSourcing} className="form"><label>Sourcing profile<select name="profile" required defaultValue=""><option value="" disabled>Select profile</option>{clients.rows.map(c => <option key={`client-${c.id}`} value={`client:${c.id}`}>{c.company_name} · Original ICP · score floor {c.minimum_score}</option>)}{runnableSegments.map(segment => <option key={`segment-${segment.id}`} value={`segment:${segment.client_id}:${segment.id}`}>{segment.company_name} · {segment.name} · score floor {segment.minimum_score}</option>)}</select></label><p className="hint">Choose exactly one market. Apollo searches only that profile and newly discovered companies are tagged to that campaign. The default run remains capped to control provider credits.</p><button type="submit" disabled={!configured}>Run automatic sourcing</button></form>
      </article>
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">CONTACT ENRICHMENT</p><h3>Find decision-makers for one pool</h3></div><span className="status">{enrichmentConfigured ? `${enrichmentProvider} connected` : "Provider needed"}</span></div>
        <form action={runContactEnrichment} className="form"><label>Prospect pool<select name="profile" required defaultValue=""><option value="" disabled>Select profile</option>{clients.rows.map(c => <option key={`enrich-client-${c.id}`} value={`client:${c.id}`}>{c.company_name} · Original ICP</option>)}{runnableSegments.map(segment => <option key={`enrich-segment-${segment.id}`} value={`segment:${segment.client_id}:${segment.id}`}>{segment.company_name} · {segment.name}</option>)}</select></label><p className="hint">Prospeo only touches qualified, Partial prospects from the selected pool and uses that campaign’s decision-maker titles. Verified work emails only; no outreach is sent.</p><button type="submit" disabled={!enrichmentConfigured}>Run contact enrichment</button></form>
      </article>
    </section>

    <section className="panel"><div className="panelHead"><div><p className="eyebrow">PIPELINE</p><h3>Guardrails stay the same for every industry</h3></div></div><div className="health"><div><span>Campaign isolation</span><b>Required</b></div><div><span>Company discovery</span><b>{configured ? provider : "Provider needed"}</b></div><div><span>Duplicate check</span><b>Client-wide</b></div><div><span>Suppression check</span><b>Required</b></div><div><span>ICP scoring</span><b>Per campaign</b></div><div><span>Decision-maker enrichment</span><b>{enrichmentConfigured ? enrichmentProvider : "Ready for Prospeo"}</b></div><div><span>Verified work email</span><b>{enrichmentConfigured ? "Verified only" : "Provider needed"}</b></div><div><span>Outreach</span><b>Still separate / controlled</b></div></div></section>

    <section className="panel"><div className="panelHead"><div><p className="eyebrow">RECENT RUNS</p><h3>Sourcing history</h3></div></div>{runs.rows.length ? <div className="tableWrap"><table><thead><tr><th>Client</th><th>Profile</th><th>Provider</th><th>Status</th><th>Discovered</th><th>Inserted</th><th>Duplicates</th><th>Qualified</th><th>Time</th></tr></thead><tbody>{runs.rows.map(r => <tr key={r.id}><td><strong>{r.company_name}</strong>{r.error_message ? <div className="muted">{r.error_message}</div> : null}</td><td>{r.segment_name || "Original ICP"}</td><td>{r.provider}</td><td><span className="status">{r.status}</span></td><td>{r.discovered_count}</td><td>{r.inserted_count}</td><td>{r.duplicate_count}</td><td>{r.qualified_count}</td><td>{new Date(r.created_at).toLocaleString("en-US")}</td></tr>)}</tbody></table></div> : <div className="empty">No sourcing runs yet.</div>}</section>
  </AppShell>;
}
