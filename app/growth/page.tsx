import Link from "next/link";
import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getConnectWorkerSummary } from "@/lib/connect-workers";
import { initializeSelfAcquisitionCampaign, queueSelfAcquisitionWorkerPipeline, runSelfAcquisitionActivePilot } from "./actions";

export const dynamic = "force-dynamic";

export default async function GrowthPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const pool = getPool();
  const clientResult = await pool.query(`SELECT c.*,i.target_industries,i.target_geographies,i.min_employees,i.max_employees,i.decision_maker_titles,i.exclusions,i.minimum_score FROM connect_clients c LEFT JOIN connect_icp_profiles i ON i.client_id=c.id WHERE lower(c.company_name)=lower('ArborLine Connect') ORDER BY c.created_at LIMIT 1`);
  const client = clientResult.rows[0] ?? null;
  const workerMasterEnabled = process.env.CONNECT_WORKERS_ENABLED === "true";
  const providerSpendEnabled = process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED === "true";
  const liveOutreachEnabled = process.env.CONNECT_LIVE_OUTREACH_ENABLED === "true";

  let stats = { prospects:0, qualified:0, enriched:0, ready:0, drafts:0, approved:0, contacted:0 };
  if (client) {
    const result = await pool.query(`SELECT
      count(DISTINCT p.id)::int AS prospects,
      count(DISTINCT p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
      count(DISTINCT p.id) FILTER (WHERE p.contact_email IS NOT NULL AND p.enrichment_status='ENRICHED')::int AS enriched,
      count(DISTINCT p.id) FILTER (WHERE p.outreach_status='READY' AND p.suppression_status='CLEAR' AND p.contact_email IS NOT NULL)::int AS ready,
      count(DISTINCT m.id) FILTER (WHERE m.status='DRAFT')::int AS drafts,
      count(DISTINCT m.id) FILTER (WHERE m.status='QUEUED')::int AS approved,
      count(DISTINCT p.id) FILTER (WHERE p.outreach_status='CONTACTED')::int AS contacted
      FROM connect_prospects p LEFT JOIN connect_outreach_messages m ON m.prospect_id=p.id WHERE p.client_id=$1`, [client.id]);
    stats = { ...stats, ...(result.rows[0] ?? {}) };
  }

  let workers = { available: false, queued:0, running:0, retrying:0, succeeded:0, blocked:0, failed:0, last_completed_at:null as string | null, latest_worker:null as string | null, latest_status:null as string | null };
  if (client) {
    try {
      const summary = await getConnectWorkerSummary(client.id);
      workers = { ...workers, ...summary, available: true };
    } catch {
      // Migration 018 is additive; keep Growth usable until the release applies it.
    }
  }

  let conversations = { available: false, replies: 0, interested: 0, needsReview: 0, handoffs: 0 };
  if (client) {
    try {
      const replyResult = await pool.query(
        `SELECT count(*)::int AS replies,
                count(*) FILTER (WHERE classification='INTERESTED')::int AS interested,
                count(*) FILTER (WHERE classification_status='NEEDS_REVIEW')::int AS needs_review
         FROM connect_replies WHERE client_id=$1`,
        [client.id]
      );
      const handoffResult = await pool.query(`SELECT count(*)::int AS handoffs FROM connect_handoffs WHERE client_id=$1`, [client.id]);
      conversations = {
        available: true,
        replies: replyResult.rows[0]?.replies ?? 0,
        interested: replyResult.rows[0]?.interested ?? 0,
        needsReview: replyResult.rows[0]?.needs_review ?? 0,
        handoffs: handoffResult.rows[0]?.handoffs ?? 0
      };
    } catch {
      // Migration 019 is additive; keep Growth usable until the release applies it.
    }
  }

  const setup = Array.isArray(params.setup) ? params.setup[0] : params.setup;
  const workerNotice = Array.isArray(params.workers) ? params.workers[0] : params.workers;
  const pilotNotice = Array.isArray(params.pilot) ? params.pilot[0] : params.pilot;

  return <AppShell active="Growth">
    <header><div><p className="eyebrow">ARBORLINE SELLS ARBORLINE</p><h1>Founding Client growth</h1><p className="muted">Use the Connect engine to find commercial cleaning companies that could become ArborLine Connect customers.</p></div></header>

    {setup === "ready" ? <div className="notice"><strong>Self-acquisition campaign is ready.</strong> The ICP is configured for a controlled IL/IN/WI launch. No outreach was sent.</div> : null}
    {setup === "failed" ? <div className="notice"><strong>Campaign setup failed.</strong> No prospects were contacted.</div> : null}
    {workerNotice === "ran" ? <div className="notice"><strong>Safe worker dry-run completed.</strong> Sourcing, enrichment, qualification, and draft readiness were inspected without provider spending or outreach.</div> : null}
    {workerNotice === "already_ran" ? <div className="notice"><strong>This dry-run window has already completed.</strong> The idempotency guard prevented duplicate work.</div> : null}
    {workerNotice === "failed" ? <div className="notice"><strong>Worker dry-run could not complete.</strong> No provider call or outreach occurred.</div> : null}
    {pilotNotice === "ran" ? <div className="notice"><strong>Controlled prospect pilot completed.</strong> Refresh the pipeline counts below and review any prepared drafts before approving outreach.</div> : null}
    {pilotNotice === "attention" ? <div className="notice"><strong>The controlled pilot ran but needs attention.</strong> Review the worker status below before retrying. Live outreach remains off.</div> : null}
    {pilotNotice === "nothing_to_run" ? <div className="notice"><strong>No active pilot work was waiting.</strong> No duplicate provider call was made.</div> : null}
    {pilotNotice === "workers_off" ? <div className="notice"><strong>Worker master switch is off.</strong> The pilot did not run.</div> : null}
    {pilotNotice === "provider_off" ? <div className="notice"><strong>Provider spending is off.</strong> The pilot did not call Apollo or Prospeo.</div> : null}
    {pilotNotice === "failed" ? <div className="notice"><strong>Controlled pilot failed before completion.</strong> Live outreach remains off; review worker status before retrying.</div> : null}

    {!client ? <section className="panel"><div className="panelHead"><div><p className="eyebrow">ONE-TIME SETUP</p><h3>Create ArborLine's internal growth campaign</h3></div><span className="status">Not initialized</span></div><p className="muted">This creates an internal ArborLine Connect client profile and ICP only. It does not source companies, spend provider credits, generate email, or contact anyone.</p><form action={initializeSelfAcquisitionCampaign}><button type="submit">Initialize self-acquisition campaign</button></form></section> : <>
      <section className="grid stats">
        <article className="card"><p>Prospects</p><h2>{stats.prospects}</h2><small>Commercial cleaning companies found</small></article>
        <article className="card"><p>Qualified</p><h2>{stats.qualified}</h2><small>Fit score ≥ {client.minimum_score ?? 70}</small></article>
        <article className="card"><p>Verified contacts</p><h2>{stats.enriched}</h2><small>Decision-makers with work email</small></article>
        <article className="card"><p>Ready for review</p><h2>{stats.ready}</h2><small>Qualified + clear suppression</small></article>
      </section>

      <section className="panel" style={{marginBottom:12}}>
        <div className="panelHead"><div><p className="eyebrow">AUTOMATION WORKERS</p><h3>Prospect → enrichment → qualification → draft → reply → handoff</h3></div><span className="status">{workerMasterEnabled ? "Workers on" : "Workers off"}</span></div>
        <p className="muted">The worker chain is database-backed with locking, retries, idempotency, and attempt history. Draft preparation never approves or sends an email. Replies are event-driven when receiving is enabled, while the general queue gets a daily scheduled wake-up on the current hosting plan.</p>
        <div className="health">
          <div><span>Queue</span><b>{workers.available ? `${workers.queued} queued · ${workers.running} running` : "Migration pending"}</b></div>
          <div><span>Completed jobs</span><b>{workers.available ? workers.succeeded : 0}</b></div>
          <div><span>Needs attention</span><b>{workers.available ? workers.retrying + workers.blocked + workers.failed : 0}</b></div>
          <div><span>Latest stage</span><b>{workers.latest_worker ? `${workers.latest_worker} · ${workers.latest_status}` : "Not run yet"}</b></div>
          <div><span>Replies</span><b>{conversations.available ? `${conversations.replies} total · ${conversations.interested} interested` : "Conversation migration pending"}</b></div>
          <div><span>Reply review</span><b>{conversations.available ? conversations.needsReview : 0}</b></div>
          <div><span>Handoffs ready</span><b>{conversations.available ? conversations.handoffs : 0}</b></div>
          <div><span>Worker master</span><b>{workerMasterEnabled ? "ON" : "OFF"}</b></div>
          <div><span>Provider spending</span><b>{providerSpendEnabled ? "ON · controlled pilot" : "OFF"}</b></div>
          <div><span>Live outreach</span><b>{liveOutreachEnabled ? "ON" : "OFF"}</b></div>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <form action={queueSelfAcquisitionWorkerPipeline}><button type="submit" disabled={!workers.available}>Run safe worker dry-run</button></form>
          <form action={runSelfAcquisitionActivePilot}><button type="submit" disabled={!workers.available || !workerMasterEnabled || !providerSpendEnabled}>Run controlled 20-company pilot now</button></form>
        </div>
        <small className="muted">The controlled pilot may call Apollo and Prospeo. It stops at draft preparation; follow-up and live outreach remain separately locked until production validation.</small>
      </section>

      <section className="split">
        <article className="panel"><div className="panelHead"><div><p className="eyebrow">FOUNDING CLIENT ICP</p><h3>Who ArborLine should sell to</h3></div><span className="status">Controlled launch</span></div><div className="health"><div><span>Industries</span><b>{(client.target_industries ?? []).join(", ")}</b></div><div><span>Geography</span><b>{(client.target_geographies ?? []).join(", ")}</b></div><div><span>Employees</span><b>{client.min_employees}–{client.max_employees}</b></div><div><span>Decision makers</span><b>{(client.decision_maker_titles ?? []).join(", ")}</b></div><div><span>Excluded</span><b>{(client.exclusions ?? []).join(", ")}</b></div><div><span>Offer</span><b>$750/month · $0 setup · month-to-month</b></div></div></article>
        <article className="panel"><div className="panelHead"><div><p className="eyebrow">SALES PIPELINE</p><h3>From company to customer</h3></div></div><div className="health"><div><span>Discovered</span><b>{stats.prospects}</b></div><div><span>Enriched</span><b>{stats.enriched}</b></div><div><span>Drafts awaiting review</span><b>{stats.drafts}</b></div><div><span>Approved</span><b>{stats.approved}</b></div><div><span>Contacted</span><b>{stats.contacted}</b></div><div><span>Replies</span><b>{conversations.replies}</b></div><div><span>Interested</span><b>{conversations.interested}</b></div><div><span>Handoffs</span><b>{conversations.handoffs}</b></div><div><span>Live sending</span><b>{liveOutreachEnabled ? "Enabled" : "Locked"}</b></div></div></article>
      </section>

      <section className="panel" style={{marginBottom:12}}><div className="panelHead"><div><p className="eyebrow">NEXT ACTION</p><h3>Run the engine in controlled stages</h3></div></div><p className="muted">Start with company discovery, enrich decision-makers, then review every prepared email before approval. Incoming replies can be classified and converted into handoffs once the worker master switch is deliberately enabled.</p><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><Link className="button" href={`/sourcing?client=${encodeURIComponent(client.id)}`}>1. Source cleaning companies</Link><Link className="button" href={`/campaigns?client=${encodeURIComponent(client.id)}`}>2. Review outreach</Link><Link className="button" href="/appointments">3. Review handoffs</Link><Link className="button" href={`/clients/${client.id}`}>Edit ArborLine ICP</Link></div></section>

      <section className="panel"><div className="panelHead"><div><p className="eyebrow">OUTREACH POSITIONING</p><h3>Founding Client sequence</h3></div><span className="status">Josh Thomas</span></div><div className="exception"><span className="severity review">EMAIL 1</span><div className="grow"><strong>More qualified sales conversations?</strong><p>Introduce ArborLine as a system built for recurring-service businesses, explain that it handles prospect discovery, decision-maker enrichment and qualified outreach, then offer one of the first 3–5 Founding Client spots at $750/month with no setup fee.</p></div></div><div className="exception"><span className="severity">FOLLOW-UP</span><div className="grow"><strong>Short value reminder</strong><p>Focus on the economics of winning one recurring commercial account and ask whether a 15-minute conversation is worth exploring. Follow-up automation stays off until production outreach is validated.</p></div></div><div className="exception"><span className="severity">CLOSE</span><div className="grow"><strong>Respectful final touch</strong><p>Close the loop without pressure and stop outreach after opt-out, suppression, bounce, complaint, or the sequence limit.</p></div></div></section>
    </>}
  </AppShell>;
}
