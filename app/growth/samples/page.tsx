import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { deriveFreeSampleSearchCriteria, freeSampleProvider, freeSampleProviderSpendEnabled } from "@/lib/connect-free-sample";
import { generateFreeSample, setFreeSampleMatchSelected, updateFreeSampleStatus } from "./actions";

export const dynamic = "force-dynamic";

function formatWhen(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function externalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 5) : [];
}

export default async function FreeSampleQueuePage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const notice = Array.isArray(params.status) ? params.status[0] : params.status;
  const generatedCount = Array.isArray(params.count) ? params.count[0] : params.count;
  const pool = getPool();
  const provider = freeSampleProvider();
  const providerSpendEnabled = freeSampleProviderSpendEnabled();

  const [summaryResult, requestsResult, matchesResult] = await Promise.all([
    pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE sample_status='REQUESTED')::int AS requested,
      count(*) FILTER (WHERE sample_status='IN_PROGRESS')::int AS in_progress,
      count(*) FILTER (WHERE sample_status='READY')::int AS ready,
      count(*) FILTER (WHERE sample_status='DELIVERED')::int AS delivered
      FROM connect_pilot_interest WHERE request_type='FREE_SAMPLE'`),
    pool.query(`SELECT id,name,work_email,company_name,industry,service_area,website,notes,target_customer,
      decision_maker_titles,sample_status,sample_prepared_at,sample_delivered_at,sample_provider,
      sample_search_criteria,sample_generation_error,sample_generated_at,created_at,updated_at
      FROM connect_pilot_interest
      WHERE request_type='FREE_SAMPLE'
      ORDER BY CASE sample_status
        WHEN 'REQUESTED' THEN 0
        WHEN 'IN_PROGRESS' THEN 1
        WHEN 'READY' THEN 2
        WHEN 'DELIVERED' THEN 3
        ELSE 4 END,
        created_at DESC
      LIMIT 100`),
    pool.query(`SELECT id,request_id,rank,company_name,website,domain,industry,city,state,country,
      employee_count,source,source_url,match_score,match_reasons,selected,created_at
      FROM connect_free_sample_matches
      ORDER BY request_id,rank`)
  ]);

  const summary = summaryResult.rows[0] ?? { total:0, requested:0, in_progress:0, ready:0, delivered:0 };
  const matchesByRequest = new Map<string, typeof matchesResult.rows>();
  for (const match of matchesResult.rows) {
    const requestId = String(match.request_id);
    const list = matchesByRequest.get(requestId) ?? [];
    list.push(match);
    matchesByRequest.set(requestId, list);
  }

  return <AppShell active="Samples">
    <header><div><p className="eyebrow">INBOUND GROWTH</p><h1>Free prospect samples</h1><p className="muted">Turn an inbound ICP request into a ranked 3–5 company sample. Provider spend requires an explicit staff click; generated companies stay isolated from campaigns and outreach.</p></div><a className="button" href="/sample" target="_blank" rel="noreferrer">Open public sample page</a></header>

    {notice === "updated" ? <div className="notice"><strong>Sample workflow updated.</strong> No email was sent by this action.</div> : null}
    {notice === "generated" ? <div className="notice"><strong>{generatedCount || "Up to 5"} ranked matches prepared.</strong> They are ready for staff review; no outreach or sample-delivery email was sent.</div> : null}
    {notice === "selection_updated" ? <div className="notice"><strong>Sample selection updated.</strong> The printable preview now reflects the selected companies.</div> : null}
    {notice === "provider_off" ? <div className="notice"><strong>Provider spending is off.</strong> No sourcing call was made.</div> : null}
    {notice === "provider_missing" ? <div className="notice"><strong>No sample sourcing provider is configured.</strong> No external call was made.</div> : null}
    {notice === "generation_failed" ? <div className="notice"><strong>Sample generation needs attention.</strong> The request was returned to the New queue and no outreach was sent.</div> : null}
    {notice === "invalid" ? <div className="notice"><strong>That sample update was not valid.</strong> Nothing changed.</div> : null}

    <section className="grid stats">
      <article className="card"><p>Requests</p><h2>{summary.total}</h2><small>All free sample requests</small></article>
      <article className="card"><p>New</p><h2>{summary.requested}</h2><small>Need target-profile review</small></article>
      <article className="card"><p>Preparing</p><h2>{summary.in_progress}</h2><small>Sample generation in progress</small></article>
      <article className="card"><p>Ready</p><h2>{summary.ready}</h2><small>Ranked sample prepared</small></article>
      <article className="card"><p>Delivered</p><h2>{summary.delivered}</h2><small>Marked delivered by staff</small></article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">GENERATION CONTROLS</p><h3>Automate the research, not the external actions.</h3></div><span className="status">{provider} · {providerSpendEnabled ? "credits armed" : "credits locked"}</span></div>
      <div className="health">
        <div><span>Website intake</span><b>Automatic</b></div>
        <div><span>ICP conversion</span><b>Automatic</b></div>
        <div><span>Company sourcing</span><b>Staff click only</b></div>
        <div><span>Ranking</span><b>Automatic · top 5</b></div>
        <div><span>Campaign enrollment</span><b>Never</b></div>
        <div><span>Prospect outreach</span><b>Never from samples</b></div>
        <div><span>Sample delivery</span><b>Staff-controlled</b></div>
        <div><span>Paid enrollment</span><b>Never automatic</b></div>
      </div>
      <small className="muted">The Generate button may use Apollo credits when provider spending is enabled. It only finds companies for the requester sample; it does not enrich contacts, create outreach drafts, or send messages.</small>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">SAMPLE QUEUE</p><h3>Requests waiting for ArborLine</h3></div><span className="status">{requestsResult.rows.length} shown</span></div>
      {requestsResult.rows.length === 0 ? <p className="muted">No free prospect sample requests yet. The public funnel is ready to receive them.</p> : requestsResult.rows.map((request) => {
        const requestMatches = matchesByRequest.get(String(request.id)) ?? [];
        const selectedCount = requestMatches.filter(match => match.selected).length;
        const criteria = deriveFreeSampleSearchCriteria(request);
        const requesterWebsite = externalUrl(request.website);
        return <article className="exception" key={request.id} style={{alignItems:"flex-start"}}>
          <span className={`severity ${request.sample_status === "REQUESTED" ? "review" : ""}`}>{label(request.sample_status)}</span>
          <div className="grow">
            <strong>{request.company_name}</strong>
            <p>{request.name} · {request.work_email}{request.industry ? ` · ${request.industry}` : ""}</p>
            <div className="health" style={{marginTop:10}}>
              <div><span>Search targets</span><b>{criteria.target_industries.join(" · ") || "Needs review"}</b></div>
              <div><span>Target geography</span><b>{criteria.target_geographies.join(" · ") || "Nationwide / unspecified"}</b></div>
              <div><span>Decision makers</span><b>{criteria.decision_maker_titles.join(" · ") || "Not specified"}</b></div>
              <div><span>Requested</span><b>{formatWhen(request.created_at)}</b></div>
              <div><span>Generated</span><b>{formatWhen(request.sample_generated_at)}</b></div>
              <div><span>Selected matches</span><b>{selectedCount}/{requestMatches.length}</b></div>
            </div>
            <p><strong>Ideal customer:</strong> {request.target_customer}</p>
            {request.notes ? <p><strong>Extra matching notes:</strong> {request.notes}</p> : null}
            {request.sample_generation_error ? <div className="notice"><strong>Last generation error:</strong> {request.sample_generation_error}</div> : null}

            {requestMatches.length ? <div style={{display:"grid",gap:8,marginTop:12}}>{requestMatches.map((match) => {
              const website = externalUrl(match.website || match.domain);
              return <div className="exception" key={match.id} style={{padding:12,alignItems:"flex-start",opacity:match.selected ? 1 : .58}}>
                <span className={`severity ${Number(match.match_score) >= 70 ? "docs" : "review"}`}>#{match.rank} · {match.match_score}</span>
                <div className="grow"><strong>{match.company_name}</strong><p>{[match.industry,match.city,match.state,match.employee_count ? `${match.employee_count} employees` : null].filter(Boolean).join(" · ") || "Company details limited"}</p><small className="muted">{reasons(match.match_reasons).join(" · ")}</small></div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {website ? <a className="button" href={website} target="_blank" rel="noreferrer">Website</a> : null}
                  <form action={setFreeSampleMatchSelected}>
                    <input type="hidden" name="requestId" value={request.id}/><input type="hidden" name="matchId" value={match.id}/><input type="hidden" name="selected" value={match.selected ? "false" : "true"}/>
                    <button type="submit">{match.selected ? "Exclude" : "Include"}</button>
                  </form>
                </div>
              </div>;
            })}</div> : <p className="muted">No matches generated yet. Review the search targets above before spending provider credits.</p>}

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
              <form action={generateFreeSample}>
                <input type="hidden" name="id" value={request.id}/>
                <button type="submit" disabled={!providerSpendEnabled || provider === "NONE"}>{requestMatches.length ? `Regenerate 5 matches · ${provider} credits` : `Generate 5 matches · ${provider} credits`}</button>
              </form>
              {requestMatches.length ? <a className="button" href={`/growth/samples/${request.id}/preview`} target="_blank" rel="noreferrer">Open branded preview</a> : null}
              {["REQUESTED","IN_PROGRESS","READY","DELIVERED","DECLINED"].map((status) => <form action={updateFreeSampleStatus} key={status}>
                <input type="hidden" name="id" value={request.id}/><input type="hidden" name="status" value={status}/>
                <button type="submit" disabled={request.sample_status === status}>{label(status)}</button>
              </form>)}
              {requesterWebsite ? <a className="button" href={requesterWebsite} target="_blank" rel="noreferrer">Requester website</a> : null}
              <a className="button" href={`mailto:${request.work_email}`}>Email requester</a>
            </div>
            <small className="muted">Generate is the only control here that can call a paid data provider, and its label identifies that spend. Status, selection, preview, and email-link actions do not send anything through ArborLine.</small>
          </div>
        </article>;
      })}
    </section>
  </AppShell>;
}
