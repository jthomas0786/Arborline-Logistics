import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { updateFreeSampleStatus } from "./actions";

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

export default async function FreeSampleQueuePage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const notice = Array.isArray(params.status) ? params.status[0] : params.status;
  const pool = getPool();

  const [summaryResult, requestsResult] = await Promise.all([
    pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE sample_status='REQUESTED')::int AS requested,
      count(*) FILTER (WHERE sample_status='IN_PROGRESS')::int AS in_progress,
      count(*) FILTER (WHERE sample_status='READY')::int AS ready,
      count(*) FILTER (WHERE sample_status='DELIVERED')::int AS delivered
      FROM connect_pilot_interest WHERE request_type='FREE_SAMPLE'`),
    pool.query(`SELECT id,name,work_email,company_name,industry,service_area,website,notes,target_customer,
      decision_maker_titles,sample_status,sample_prepared_at,sample_delivered_at,created_at,updated_at
      FROM connect_pilot_interest
      WHERE request_type='FREE_SAMPLE'
      ORDER BY CASE sample_status
        WHEN 'REQUESTED' THEN 0
        WHEN 'IN_PROGRESS' THEN 1
        WHEN 'READY' THEN 2
        WHEN 'DELIVERED' THEN 3
        ELSE 4 END,
        created_at DESC
      LIMIT 100`)
  ]);

  const summary = summaryResult.rows[0] ?? { total:0, requested:0, in_progress:0, ready:0, delivered:0 };

  return <AppShell active="Samples">
    <header><div><p className="eyebrow">INBOUND GROWTH</p><h1>Free prospect samples</h1><p className="muted">Website visitors can request a 3–5 company sample. Requests land here for controlled preparation and review; nothing is sent to prospects automatically.</p></div><a className="button" href="/sample" target="_blank" rel="noreferrer">Open public sample page</a></header>

    {notice === "updated" ? <div className="notice"><strong>Sample workflow updated.</strong> No email was sent by this action.</div> : null}
    {notice === "invalid" ? <div className="notice"><strong>That sample update was not valid.</strong> Nothing changed.</div> : null}

    <section className="grid stats">
      <article className="card"><p>Requests</p><h2>{summary.total}</h2><small>All free sample requests</small></article>
      <article className="card"><p>New</p><h2>{summary.requested}</h2><small>Need target-profile review</small></article>
      <article className="card"><p>Preparing</p><h2>{summary.in_progress}</h2><small>Sample work in progress</small></article>
      <article className="card"><p>Ready</p><h2>{summary.ready}</h2><small>Prepared for manual delivery</small></article>
      <article className="card"><p>Delivered</p><h2>{summary.delivered}</h2><small>Marked delivered by staff</small></article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">SAFETY MODEL</p><h3>Inbound capture is automatic. External actions are not.</h3></div><span className="status">Controlled</span></div>
      <div className="health">
        <div><span>Website intake</span><b>Automatic</b></div>
        <div><span>Duplicate guard</span><b>24 hours</b></div>
        <div><span>Prospect provider spend</span><b>Not triggered here</b></div>
        <div><span>Prospect outreach</span><b>Not authorized</b></div>
        <div><span>Sample delivery</span><b>Staff-controlled</b></div>
        <div><span>Paid enrollment</span><b>Never automatic</b></div>
      </div>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">SAMPLE QUEUE</p><h3>Requests waiting for ArborLine</h3></div><span className="status">{requestsResult.rows.length} shown</span></div>
      {requestsResult.rows.length === 0 ? <p className="muted">No free prospect sample requests yet. The public funnel is ready to receive them.</p> : requestsResult.rows.map((request) => <article className="exception" key={request.id} style={{alignItems:"flex-start"}}>
        <span className={`severity ${request.sample_status === "REQUESTED" ? "review" : ""}`}>{label(request.sample_status)}</span>
        <div className="grow">
          <strong>{request.company_name}</strong>
          <p>{request.name} · {request.work_email}{request.industry ? ` · ${request.industry}` : ""}</p>
          <div className="health" style={{marginTop:10}}>
            <div><span>Target geography</span><b>{request.service_area || "Not specified"}</b></div>
            <div><span>Decision makers</span><b>{request.decision_maker_titles || "Not specified"}</b></div>
            <div><span>Ideal customer</span><b>{request.target_customer}</b></div>
            <div><span>Requested</span><b>{formatWhen(request.created_at)}</b></div>
            <div><span>Prepared</span><b>{formatWhen(request.sample_prepared_at)}</b></div>
            <div><span>Delivered</span><b>{formatWhen(request.sample_delivered_at)}</b></div>
          </div>
          {request.notes ? <p><strong>Extra matching notes:</strong> {request.notes}</p> : null}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            {["REQUESTED","IN_PROGRESS","READY","DELIVERED","DECLINED"].map((status) => <form action={updateFreeSampleStatus} key={status}>
              <input type="hidden" name="id" value={request.id}/>
              <input type="hidden" name="status" value={status}/>
              <button type="submit" disabled={request.sample_status === status}>{label(status)}</button>
            </form>)}
            {request.website ? <a className="button" href={request.website} target="_blank" rel="noreferrer">Company website</a> : null}
            <a className="button" href={`mailto:${request.work_email}`}>Email requester</a>
          </div>
          <small className="muted">Changing this status only updates the internal queue. The email link opens your mail client; ArborLine does not send it automatically.</small>
        </div>
      </article>)}
    </section>
  </AppShell>;
}
