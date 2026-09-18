import Link from "next/link";
import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function label(value: unknown) {
  return String(value || "—").replaceAll("_", " ");
}

function formatCt(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function statusClass(value: unknown) {
  return String(value || "").toUpperCase() === "ACTIVE" ? "status booked" : "status";
}

export default async function NationalResearchPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const clientResult = await pool.query(
    `SELECT id FROM connect_clients
     WHERE lower(company_name)=lower('ArborLine Connect')
       AND status IN ('READY','ACTIVE','ONBOARDING')
     ORDER BY created_at ASC LIMIT 1`
  );
  const clientId = String(clientResult.rows[0]?.id || "");

  const providerFallbackSwitch = process.env.CONNECT_NATIONAL_PROVIDER_FALLBACK_ENABLED === "true";
  const providerSpendSwitch = process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED === "true";
  const paidFallbackLive = providerFallbackSwitch && providerSpendSwitch;

  const [summaryResult, marketsResult, workersResult, candidatesResult, mailboxResult, segmentsResult, jobsResult] = clientId
    ? await Promise.all([
        pool.query(
          `SELECT
             count(DISTINCT m.id) FILTER (WHERE m.status='ACTIVE' AND m.market_type='METRO')::int AS active_metros,
             count(DISTINCT m.id) FILTER (WHERE m.status='PLANNED' AND m.market_type='METRO' AND m.tier=1)::int AS planned_tier1_metros,
             count(ms.id) FILTER (WHERE ms.status='ACTIVE' AND m.status='ACTIVE')::int AS active_cells,
             count(DISTINCT ms.segment_id) FILTER (WHERE ms.status='ACTIVE' AND m.status='ACTIVE')::int AS active_segments,
             count(DISTINCT p.id)::int AS prospects,
             count(DISTINCT p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status'='MATCH')::int AS service_fit_match,
             count(DISTINCT p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
             count(DISTINCT p.id) FILTER (WHERE public.connect_contact_is_verified(p))::int AS verified_contacts,
             count(DISTINCT p.id) FILTER (WHERE p.outreach_status='READY')::int AS ready,
             (SELECT count(*)::int FROM connect_prepared_outreach_drafts pd WHERE pd.client_id=$1 AND pd.status='PREPARED') AS prepared_drafts,
             count(DISTINCT p.id) FILTER (WHERE coalesce(p.source_metadata->>'qualification_acceleration_checked_at','')<>'')::int AS acceleration_checked
           FROM connect_research_markets m
           LEFT JOIN connect_market_segments ms ON ms.market_id=m.id AND ms.client_id=$1
           LEFT JOIN connect_prospects p ON p.client_id=$1 AND p.market_id=m.id AND p.segment_id=ms.segment_id`,
          [clientId]
        ),
        pool.query(
          `SELECT
             m.id,m.slug,m.name,m.tier,m.status,m.state_codes,m.metadata,
             count(DISTINCT ms.segment_id) FILTER (WHERE ms.status='ACTIVE')::int AS active_segments,
             count(DISTINCT p.id)::int AS prospects,
             count(DISTINCT p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status' IN ('MATCH','REVIEW','MISMATCH'))::int AS fit_checked,
             count(DISTINCT p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status'='MATCH')::int AS fit_match,
             count(DISTINCT p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
             count(DISTINCT p.id) FILTER (WHERE public.connect_contact_is_verified(p))::int AS verified_contacts,
             count(DISTINCT p.id) FILTER (WHERE p.outreach_status='READY')::int AS ready,
             count(DISTINCT om.id) FILTER (WHERE om.status='DRAFT')::int AS drafts,
             count(DISTINCT pd.id) FILTER (WHERE pd.status='PREPARED')::int AS prepared,
             count(DISTINCT pd.id) FILTER (WHERE pd.status='PREPARED')::int AS prepared,
             max(p.updated_at) AS latest_update
           FROM connect_research_markets m
           LEFT JOIN connect_market_segments ms ON ms.market_id=m.id AND ms.client_id=$1
           LEFT JOIN connect_prospects p ON p.client_id=$1 AND p.market_id=m.id AND p.segment_id=ms.segment_id
           LEFT JOIN connect_outreach_messages om ON om.prospect_id=p.id
           LEFT JOIN connect_prepared_outreach_drafts pd ON pd.prospect_id=p.id
           WHERE m.market_type='METRO' AND m.tier IN (1,2)
           GROUP BY m.id
           ORDER BY CASE WHEN m.status='ACTIVE' THEN 0 ELSE 1 END,m.tier,m.priority,m.name`,
          [clientId]
        ),
        pool.query(
          `SELECT worker_type,status,count(*)::int AS jobs,max(updated_at) AS latest
           FROM connect_worker_jobs
           WHERE client_id=$1
             AND worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','MAILBOX_VERIFY','PROVIDER_ENRICH','ENRICH')
             AND created_at >= now()-interval '24 hours'
           GROUP BY worker_type,status
           ORDER BY worker_type,status`,
          [clientId]
        ),
        pool.query(
          `SELECT email_status,count(*)::int AS candidates
           FROM connect_contact_candidates
           WHERE client_id=$1
           GROUP BY email_status
           ORDER BY candidates DESC,email_status`,
          [clientId]
        ),
        pool.query(
          `SELECT status,count(*)::int AS attempts,max(completed_at) AS latest
           FROM connect_mailbox_verification_attempts
           WHERE client_id=$1 AND completed_at >= now()-interval '24 hours'
           GROUP BY status
           ORDER BY attempts DESC,status`,
          [clientId]
        ),
        pool.query(
          `SELECT s.id,s.slug,s.name,
             count(DISTINCT ms.market_id) FILTER (WHERE ms.status='ACTIVE' AND m.status='ACTIVE')::int AS active_markets,
             count(DISTINCT p.id)::int AS prospects,
             count(DISTINCT p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status'='MATCH')::int AS fit_match,
             count(DISTINCT p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
             count(DISTINCT p.id) FILTER (WHERE public.connect_contact_is_verified(p))::int AS verified_contacts,
             count(DISTINCT om.id) FILTER (WHERE om.status='DRAFT')::int AS drafts
           FROM connect_prospect_segments s
           LEFT JOIN connect_market_segments ms ON ms.segment_id=s.id AND ms.client_id=s.client_id
           LEFT JOIN connect_research_markets m ON m.id=ms.market_id
           LEFT JOIN connect_prospects p ON p.client_id=s.client_id AND p.segment_id=s.id AND p.market_id=ms.market_id
           LEFT JOIN connect_outreach_messages om ON om.prospect_id=p.id
           LEFT JOIN connect_prepared_outreach_drafts pd ON pd.prospect_id=p.id
           WHERE s.client_id=$1 AND s.status='ACTIVE'
           GROUP BY s.id
           ORDER BY s.name`,
          [clientId]
        ),
        pool.query(
          `SELECT j.id,j.worker_type,j.status,j.attempts,j.max_attempts,j.priority,j.run_at,j.started_at,j.completed_at,
                  j.last_error AS error_message,m.name AS market_name,s.name AS segment_name
           FROM connect_worker_jobs j
           LEFT JOIN connect_research_markets m ON m.id=j.market_id
           LEFT JOIN connect_prospect_segments s ON s.id=j.segment_id
           WHERE j.client_id=$1
             AND j.worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','MAILBOX_VERIFY','PROVIDER_ENRICH')
           ORDER BY j.created_at DESC
           LIMIT 24`,
          [clientId]
        )
      ])
    : [{ rows: [{}] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }] as any;

  const summary = summaryResult.rows[0] || {};
  const workerTotals = workersResult.rows.reduce((acc: Record<string, number>, row: Record<string, unknown>) => {
    acc[String(row.status)] = (acc[String(row.status)] || 0) + number(row.jobs);
    return acc;
  }, {});
  const candidateTotals = candidatesResult.rows.reduce((acc: Record<string, number>, row: Record<string, unknown>) => {
    acc[String(row.email_status)] = number(row.candidates);
    return acc;
  }, {});
  const mailboxTotals = mailboxResult.rows.reduce((acc: Record<string, number>, row: Record<string, unknown>) => {
    acc[String(row.status)] = number(row.attempts);
    return acc;
  }, {});
  const activeMarkets = marketsResult.rows.filter((row: Record<string, unknown>) => String(row.status) === "ACTIVE");

  return (
    <AppShell active="Research">
      <header>
        <div>
          <p className="eyebrow">NATIONAL RESEARCH COMMAND CENTER</p>
          <h1>ArborLine National Research</h1>
          <p className="muted">One operating view for metro rollout, public research, native contact enrichment, mailbox verification, and draft production. Paid-provider fallback remains independently locked.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="button" href="/research">Local research</Link>
          <Link className="button" href="/prospects?lane=review">Prospects</Link>
          <Link className="button" href="/campaigns">Campaigns</Link>
        </div>
      </header>

      <section className="grid stats">
        <article className="card"><p>Active metros</p><h2>{number(summary.active_metros)}</h2><small>{number(summary.planned_tier1_metros)} Tier-1 metros still planned</small></article>
        <article className="card"><p>Active research cells</p><h2>{number(summary.active_cells)}</h2><small>{number(summary.active_segments)} active industry segments</small></article>
        <article className="card"><p>Market prospects</p><h2>{number(summary.prospects)}</h2><small>{number(summary.service_fit_match)} website-confirmed service fits</small></article>
        <article className="card"><p>Qualified</p><h2>{number(summary.qualified)}</h2><small>{number(summary.verified_contacts)} centrally verified contacts</small></article>
        <article className="card"><p>Prepared drafts</p><h2>{number(summary.prepared_drafts)}</h2><small>Verification pending · not sendable</small></article>
        <article className="card"><p>Qualification acceleration</p><h2>{number(summary.acceleration_checked)}</h2><small>MATCH prospects given a second decision-maker pass</small></article>
        <article className="card"><p>Paid fallback</p><h2>{paidFallbackLive ? "ON" : "LOCKED"}</h2><small>{paidFallbackLive ? "Both explicit provider-spend switches are enabled" : "Native/public research only"}</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">ROLLOUT</p><h3>Metro coverage</h3></div><span className="status booked">{activeMarkets.length} ACTIVE</span></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Market</th><th>Tier</th><th>Status</th><th>Industries</th><th>Prospects</th><th>Fit matches</th><th>Qualified</th><th>Verified</th><th>Prepared</th><th>Drafts</th><th>Latest</th></tr></thead>
            <tbody>{marketsResult.rows.map((row: Record<string, any>) => <tr key={row.id}>
              <td><strong>{row.name}</strong><div className="muted">{Array.isArray(row.state_codes) ? row.state_codes.join(" · ") : "—"}</div></td>
              <td>Tier {row.tier}</td>
              <td><span className={statusClass(row.status)}>{label(row.status)}</span></td>
              <td>{number(row.active_segments)}</td>
              <td>{number(row.prospects)}</td>
              <td>{number(row.fit_match)} <span className="muted">/ {number(row.fit_checked)} checked</span></td>
              <td>{number(row.qualified)}</td>
              <td>{number(row.verified_contacts)}</td>
              <td>{number(row.prepared)}</td>
              <td>{number(row.drafts)}</td>
              <td>{formatCt(row.latest_update)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="split" style={{ marginBottom: 12 }}>
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">WORKER FLEET</p><h3>Last 24 hours</h3></div><span className="status">15-minute cadence</span></div>
          <div className="health">
            <div><span>Queued</span><b>{workerTotals.QUEUED || 0}</b></div>
            <div><span>Running</span><b>{workerTotals.RUNNING || 0}</b></div>
            <div><span>Retry</span><b>{workerTotals.RETRY || 0}</b></div>
            <div><span>Succeeded</span><b>{workerTotals.SUCCEEDED || 0}</b></div>
            <div><span>Blocked</span><b>{workerTotals.BLOCKED || 0}</b></div>
            <div><span>Failed</span><b>{workerTotals.FAILED || 0}</b></div>
          </div>
        </article>
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">CONTACT VERIFICATION</p><h3>Native mailbox pipeline</h3></div><span className="status">Fail closed</span></div>
          <div className="health">
            <div><span>MX-valid candidates</span><b>{candidateTotals.MX_VALID || 0}</b></div>
            <div><span>Mailbox verified</span><b>{candidateTotals.VERIFIED || 0}</b></div>
            <div><span>Invalid candidates</span><b>{candidateTotals.INVALID || 0}</b></div>
            <div><span>Catch-all candidates</span><b>{candidateTotals.CATCH_ALL || 0}</b></div>
            <div><span>Verified attempts · 24h</span><b>{mailboxTotals.VERIFIED || 0}</b></div>
            <div><span>Unknown / temporary · 24h</span><b>{(mailboxTotals.UNKNOWN || 0) + (mailboxTotals.TEMPORARY || 0) + (mailboxTotals.NETWORK_BLOCKED || 0)}</b></div>
          </div>
        </article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">INDUSTRY CELLS</p><h3>Active vertical performance</h3></div><span className="badge">NATIVE / PUBLIC</span></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Industry</th><th>Active metros</th><th>Prospects</th><th>Service-fit matches</th><th>Qualified</th><th>Verified contacts</th><th>Prepared</th><th>Drafts</th></tr></thead>
            <tbody>{segmentsResult.rows.map((row: Record<string, any>) => <tr key={row.id}>
              <td><strong>{row.name}</strong><div className="muted">{row.slug}</div></td>
              <td>{number(row.active_markets)}</td>
              <td>{number(row.prospects)}</td>
              <td>{number(row.fit_match)}</td>
              <td>{number(row.qualified)}</td>
              <td>{number(row.verified_contacts)}</td>
              <td>{number(row.prepared)}</td>
              <td>{number(row.drafts)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">SAFETY</p><h3>Research-to-outreach guardrails</h3></div><span className="status booked">ENFORCED</span></div>
        <div className="health">
          <div><span>Provider fallback switch</span><b>{providerFallbackSwitch ? "ENABLED" : "OFF"}</b></div>
          <div><span>Provider spend switch</span><b>{providerSpendSwitch ? "ENABLED" : "OFF"}</b></div>
          <div><span>Paid enrichment</span><b>{paidFallbackLive ? "AVAILABLE" : "LOCKED"}</b></div>
          <div><span>MX-only promotion</span><b>BLOCKED</b></div>
          <div><span>Catch-all promotion</span><b>BLOCKED</b></div>
          <div><span>Human outreach approval</span><b>REQUIRED</b></div>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>Native/public research may discover, verify, qualify, and prepare DRAFTS. It does not approve, queue, or send prospect outreach.</p>
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">RECENT WORK</p><h3>National worker jobs</h3></div><span className="status">Latest 24 shown</span></div>
        {jobsResult.rows.length ? <div className="tableWrap"><table>
          <thead><tr><th>Worker</th><th>Market</th><th>Industry</th><th>Status</th><th>Attempts</th><th>Started</th><th>Completed</th></tr></thead>
          <tbody>{jobsResult.rows.map((row: Record<string, any>) => <tr key={row.id}>
            <td><strong>{label(row.worker_type)}</strong></td>
            <td>{row.market_name || "All active markets"}</td>
            <td>{row.segment_name || "—"}</td>
            <td><span className={String(row.status) === "SUCCEEDED" ? "status booked" : "status"}>{label(row.status)}</span>{row.error_message ? <div className="muted">{String(row.error_message).slice(0, 120)}</div> : null}</td>
            <td>{number(row.attempts)} / {number(row.max_attempts)}</td>
            <td>{formatCt(row.started_at || row.run_at)}</td>
            <td>{formatCt(row.completed_at)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="empty">No national worker jobs have run yet.</div>}
      </section>
    </AppShell>
  );
}
