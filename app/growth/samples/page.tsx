import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { deriveFreeSampleSearchCriteria } from "@/lib/connect-free-sample";
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
  const provider = "OPENSTREETMAP_OVERPASS";

  const [summaryResult, requestsResult, matchesResult] = await Promise.all([
    pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE sample_status='REQUESTED')::int AS requested,
      count(*) FILTER (WHERE sample_status='IN_PROGRESS')::int AS in_progress,
      count(*) FILTER (WHERE sample_status='READY')::int AS ready,
      count(*) FILTER (WHERE sample_approved_at IS NOT NULL AND sample_email_status <> 'SENT')::int AS approved,
      count(*) FILTER (WHERE sample_email_status='SENT')::int AS delivered,
      count(*) FILTER (WHERE sample_view_count > 0)::int AS viewed,
      count(*) FILTER (WHERE sample_conversion_status IN ('INTERESTED','CONVERTED'))::int AS engaged
      FROM connect_pilot_interest WHERE request_type='FREE_SAMPLE'`),
    pool.query(`SELECT id,name,work_email,company_name,industry,service_area,website,notes,target_customer,
      decision_maker_titles,sample_status,sample_prepared_at,sample_delivered_at,sample_provider,
      sample_search_criteria,sample_generation_error,sample_generated_at,sample_approved_at,
      sample_email_status,sample_email_sent_at,sample_view_count,sample_viewed_at,sample_conversion_status,
      created_at,updated_at
      FROM connect_pilot_interest
      WHERE request_type='FREE_SAMPLE'
      ORDER BY CASE
        WHEN sample_email_status='FAILED' THEN 0
        WHEN sample_status='REQUESTED' THEN 1
        WHEN sample_status='IN_PROGRESS' THEN 2
        WHEN sample_approved_at IS NULL AND sample_status='READY' THEN 3
        WHEN sample_email_status IN ('DRAFT','APPROVED') THEN 4
        WHEN sample_email_status='SENT' AND sample_conversion_status='OPEN' THEN 5
        ELSE 6 END,
        created_at DESC
      LIMIT 100`),
    pool.query(`SELECT id,request_id,rank,company_name,website,domain,industry,city,state,country,
      employee_count,source,source_url,match_score,match_reasons,selected,created_at
      FROM connect_free_sample_matches
      ORDER BY request_id,rank`)
  ]);

  const summary = summaryResult.rows[0] ?? { total:0, requested:0, in_progress:0, ready:0, approved:0, delivered:0, viewed:0, engaged:0 };
  const matchesByRequest = new Map<string, typeof matchesResult.rows>();
  for (const match of matchesResult.rows) {
    const requestId = String(match.request_id);
    const list = matchesByRequest.get(requestId) ?? [];
    list.push(match);
    matchesByRequest.set(requestId, list);
  }

  return <AppShell active="Samples">
    <header><div><p className="eyebrow">INBOUND GROWTH</p><h1>Free prospect samples</h1><p className="muted">Turn an inbound ICP request into a ranked sample, approve the final matches, deliver it, and track whether the requester opens and converts.</p></div><a className="button" href="/sample" target="_blank" rel="noreferrer">Open public sample page</a></header>

    {notice === "updated" ? <div className="notice"><strong>Sample workflow updated.</strong> No email was sent by this action.</div> : null}
    {notice === "generated" ? <div className="notice"><strong>{generatedCount || "Up to 5"} public-data matches prepared.</strong> They are ready for staff review; no outreach or sample-delivery email was sent.</div> : null}
    {notice === "selection_updated" ? <div className="notice"><strong>Sample selection updated.</strong> The preview now reflects the selected companies.</div> : null}
    {notice === "selection_locked" ? <div className="notice"><strong>Selection is locked.</strong> Reopen the approved sample from its delivery workspace before changing matches.</div> : null}
    {notice === "reopened" ? <div className="notice"><strong>Sample reopened.</strong> Match selection can be adjusted again; the previous private link was invalidated.</div> : null}
    {notice === "reopen_blocked" ? <div className="notice"><strong>This sample cannot be reopened while sending or after delivery.</strong></div> : null}
    {notice === "approval_count" ? <div className="notice"><strong>Choose between 3 and 5 matches before approval.</strong></div> : null}
    {notice === "approval_blocked" || notice === "approval_failed" ? <div className="notice"><strong>Sample approval needs attention.</strong> No email was sent.</div> : null}
    {notice === "already_running" ? <div className="notice"><strong>This sample is already being generated.</strong> The duplicate public-data lookup was blocked.</div> : null}
    {notice === "generation_not_allowed" ? <div className="notice"><strong>This sample cannot be generated from its current workflow state.</strong> Approved, delivered, and declined samples stay locked until deliberately reopened where allowed.</div> : null}
    {notice === "needs_local_geography" ? <div className="notice"><strong>Choose a city, metro, or local region for the sample.</strong> A nationwide request is too broad for a useful 3–5 company proof sample. No external provider was called.</div> : null}
    {notice === "generation_failed" ? <div className="notice"><strong>Public sample generation needs attention.</strong> The request was returned to the New queue and no outreach was sent.</div> : null}
    {notice === "invalid" ? <div className="notice"><strong>That sample update was not valid.</strong> Nothing changed.</div> : null}

    <section className="grid stats">
      <article className="card"><p>Requests</p><h2>{summary.total}</h2><small>All free sample requests</small></article>
      <article className="card"><p>New</p><h2>{summary.requested}</h2><small>Need target-profile review</small></article>
      <article className="card"><p>Ready to approve</p><h2>{summary.ready}</h2><small>Ranked samples prepared</small></article>
      <article className="card"><p>Approved</p><h2>{summary.approved}</h2><small>Waiting for delivery</small></article>
      <article className="card"><p>Sent</p><h2>{summary.delivered}</h2><small>Delivered by ArborLine</small></article>
      <article className="card"><p>Opened</p><h2>{summary.viewed}</h2><small>Private link recorded an open</small></article>
      <article className="card"><p>Engaged</p><h2>{summary.engaged}</h2><small>Interested or converted</small></article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">GROWTH LOOP</p><h3>Automate research and tracking. Keep external actions explicit.</h3></div><span className="status">{provider} · public data · paid providers locked</span></div>
      <div className="health">
        <div><span>Website intake</span><b>Automatic</b></div>
        <div><span>ICP conversion</span><b>Automatic</b></div>
        <div><span>Company sourcing</span><b>Staff click · public data</b></div>
        <div><span>Ranking</span><b>Automatic · top 5</b></div>
        <div><span>Final approval</span><b>Staff-controlled</b></div>
        <div><span>Delivery email</span><b>Explicit Send only</b></div>
        <div><span>Open tracking</span><b>Automatic after send</b></div>
        <div><span>Paid enrollment</span><b>Never automatic</b></div>
      </div>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">SAMPLE QUEUE</p><h3>Requests waiting for ArborLine</h3></div><span className="status">{requestsResult.rows.length} shown</span></div>
      {requestsResult.rows.length === 0 ? <p className="muted">No free prospect sample requests yet. The public funnel is ready to receive them.</p> : requestsResult.rows.map((request) => {
        const requestMatches = matchesByRequest.get(String(request.id)) ?? [];
        const selectedCount = requestMatches.filter(match => match.selected).length;
        const criteria = deriveFreeSampleSearchCriteria(request);
        const requesterWebsite = externalUrl(request.website);
        const approved = Boolean(request.sample_approved_at);
        const canGenerate = !approved && (request.sample_status === "REQUESTED" || request.sample_status === "READY");
        return <article className="exception" key={request.id} style={{alignItems:"flex-start"}}>
          <span className={`severity ${request.sample_email_status === "FAILED" || request.sample_status === "REQUESTED" ? "review" : request.sample_conversion_status === "INTERESTED" ? "docs" : ""}`}>{request.sample_email_status === "SENT" ? "SENT" : approved ? "APPROVED" : label(request.sample_status)}</span>
          <div className="grow">
            <strong>{request.company_name}</strong>
            <p>{request.name} · {request.work_email}{request.industry ? ` · ${request.industry}` : ""}</p>
            <div className="health" style={{marginTop:10}}>
              <div><span>Search targets</span><b>{criteria.target_industries.join(" · ") || "Needs review"}</b></div>
              <div><span>Target geography</span><b>{criteria.target_geographies.join(" · ") || "Needs a local market"}</b></div>
              <div><span>Selected matches</span><b>{selectedCount}/{requestMatches.length}</b></div>
              <div><span>Email</span><b>{label(request.sample_email_status)}</b></div>
              <div><span>Opens</span><b>{request.sample_view_count || 0}</b></div>
              <div><span>Conversion</span><b>{label(request.sample_conversion_status)}</b></div>
            </div>
            <p><strong>Ideal customer:</strong> {request.target_customer}</p>
            {request.sample_generation_error ? <div className="notice"><strong>Last generation error:</strong> {request.sample_generation_error}</div> : null}

            {requestMatches.length ? <div style={{display:"grid",gap:8,marginTop:12}}>{requestMatches.map((match) => {
              const website = externalUrl(match.website || match.domain);
              return <div className="exception" key={match.id} style={{padding:12,alignItems:"flex-start",opacity:match.selected ? 1 : .58}}>
                <span className={`severity ${Number(match.match_score) >= 70 ? "docs" : "review"}`}>#{match.rank} · {match.match_score}</span>
                <div className="grow"><strong>{match.company_name}</strong><p>{[match.industry,match.city,match.state,match.employee_count ? `${match.employee_count} employees` : null].filter(Boolean).join(" · ") || "Company details limited"}</p><small className="muted">{reasons(match.match_reasons).join(" · ")}</small></div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {website ? <a className="button" href={website} target="_blank" rel="noreferrer">Website</a> : null}
                  {!approved ? <form action={setFreeSampleMatchSelected}><input type="hidden" name="requestId" value={request.id}/><input type="hidden" name="matchId" value={match.id}/><input type="hidden" name="selected" value={match.selected ? "false" : "true"}/><button type="submit">{match.selected ? "Exclude" : "Include"}</button></form> : null}
                </div>
              </div>;
            })}</div> : <p className="muted">No matches generated yet. Review the target and local geography above before generating the public-data sample.</p>}

            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
              <form action={generateFreeSample}><input type="hidden" name="id" value={request.id}/><button type="submit" disabled={!canGenerate}>{request.sample_status === "IN_PROGRESS" ? "Generating…" : requestMatches.length ? "Regenerate 5 public matches" : "Generate 5 public matches"}</button></form>
              {requestMatches.length ? <a className="button" href={`/growth/samples/${request.id}`}>Manage approval & delivery</a> : null}
              {requestMatches.length ? <a className="button" href={`/growth/samples/${request.id}/preview`} target="_blank" rel="noreferrer">Staff preview</a> : null}
              {requesterWebsite ? <a className="button" href={requesterWebsite} target="_blank" rel="noreferrer">Requester website</a> : null}
              <a className="button" href={`mailto:${request.work_email}`}>Email manually</a>
            </div>
            <small className="muted">Generating matches uses public OpenStreetMap data only. The queue never auto-sends; use the delivery workspace to approve the final set, edit the email, preview the customer link, and explicitly send the requested sample.</small>
          </div>
        </article>;
      })}
    </section>
  </AppShell>;
}