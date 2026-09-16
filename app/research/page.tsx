import Link from "next/link";
import { AppShell } from "../components/AppShell";
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

function nextDiscoveryRun(now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(17);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

function confidenceClass(grade: unknown) {
  return String(grade || "").toUpperCase() === "HIGH" ? "status booked" : "status";
}

export default async function ResearchPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const [runStatsResult, prospectStatsResult, backlogResult, runsResult, prospectsResult] = await Promise.all([
    pool.query(`
      SELECT
        count(*)::int AS runs,
        count(*) FILTER (WHERE status='COMPLETED')::int AS completed_runs,
        count(*) FILTER (WHERE status='FAILED')::int AS failed_runs,
        coalesce(sum(discovered_count),0)::int AS discovered,
        coalesce(sum(inserted_count),0)::int AS inserted,
        coalesce(sum(duplicate_count),0)::int AS duplicates,
        coalesce(sum(qualified_count),0)::int AS qualified
      FROM connect_sourcing_runs
      WHERE provider='ARBORLINE_PUBLIC_OSM'
        AND started_at >= now() - interval '24 hours'
    `),
    pool.query(`
      SELECT
        count(*)::int AS prospects,
        count(*) FILTER (WHERE qualification_status='QUALIFIED')::int AS qualified,
        count(*) FILTER (WHERE qualification_status='REVIEW')::int AS review,
        count(*) FILTER (WHERE coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')::int AS researched,
        count(*) FILTER (
          WHERE coalesce(nullif(source_metadata->'public_research'->>'decision_maker_confidence','')::int,0) >= 85
        )::int AS high_confidence_decision_makers,
        count(*) FILTER (WHERE source_metadata->'public_research'->>'email_status'='PUBLISHED_UNVERIFIED')::int AS published_email_candidates,
        count(*) FILTER (WHERE source_metadata->'public_research'->>'email_status'='INFERRED_UNVERIFIED')::int AS inferred_email_candidates,
        count(*) FILTER (WHERE outreach_status <> 'NOT_READY')::int AS outreach_ready
      FROM connect_prospects
      WHERE source='ARBORLINE_DISCOVERY'
        AND created_at >= now() - interval '24 hours'
    `),
    pool.query(`
      SELECT
        count(*) FILTER (
          WHERE qualification_status IN ('REVIEW','QUALIFIED')
            AND contact_email IS NULL
        )::int AS research_backlog,
        count(*) FILTER (
          WHERE qualification_status IN ('REVIEW','QUALIFIED')
            AND contact_email IS NULL
            AND NOT (coalesce(source_metadata,'{}'::jsonb) ? 'public_research_checked_at')
        )::int AS never_researched,
        count(*) FILTER (
          WHERE source_metadata->'public_research'->>'email_status'='PUBLISHED_UNVERIFIED'
            AND contact_email IS NULL
        )::int AS published_waiting_verification,
        count(*) FILTER (
          WHERE source_metadata->'public_research'->>'email_status'='INFERRED_UNVERIFIED'
            AND contact_email IS NULL
        )::int AS inferred_waiting_verification
      FROM connect_prospects
      WHERE source='ARBORLINE_DISCOVERY'
    `),
    pool.query(`
      SELECT r.id,r.status,r.started_at,r.completed_at,r.discovered_count,r.inserted_count,
             r.duplicate_count,r.qualified_count,r.error_message,r.request_payload,
             s.name AS segment_name,s.slug AS segment_slug
      FROM connect_sourcing_runs r
      LEFT JOIN connect_prospect_segments s ON s.id=r.segment_id
      WHERE r.provider='ARBORLINE_PUBLIC_OSM'
      ORDER BY r.started_at DESC
      LIMIT 12
    `),
    pool.query(`
      SELECT p.id,p.company_name,p.domain,p.city,p.state,p.qualification_status,p.qualification_score,
             p.outreach_status,p.contact_name,p.contact_title,p.contact_email,p.created_at,
             s.name AS segment_name,
             p.source_metadata->'public_research'->>'status' AS research_status,
             coalesce(nullif(p.source_metadata->'public_research'->>'decision_maker_confidence','')::int,0) AS decision_maker_confidence,
             coalesce(
               nullif(p.source_metadata->'public_research'->>'decision_maker_confidence_grade',''),
               CASE
                 WHEN coalesce(nullif(p.source_metadata->'public_research'->>'decision_maker_confidence','')::int,0) >= 85 THEN 'HIGH'
                 WHEN coalesce(nullif(p.source_metadata->'public_research'->>'decision_maker_confidence','')::int,0) >= 75 THEN 'MEDIUM'
                 ELSE NULL
               END
             ) AS decision_maker_confidence_grade,
             p.source_metadata->'public_research'->>'email_status' AS email_status,
             p.source_metadata->'public_research'->>'source_url' AS research_source_url
      FROM connect_prospects p
      LEFT JOIN connect_prospect_segments s ON s.id=p.segment_id
      WHERE p.source='ARBORLINE_DISCOVERY'
      ORDER BY p.created_at DESC
      LIMIT 30
    `)
  ]);

  const runStats = runStatsResult.rows[0] || {};
  const prospectStats = prospectStatsResult.rows[0] || {};
  const backlog = backlogResult.rows[0] || {};
  const latestRun = runsResult.rows[0] || null;
  const latestPayload = latestRun?.request_payload && typeof latestRun.request_payload === "object" ? latestRun.request_payload : {};
  const nextRun = nextDiscoveryRun();
  const sourceHealth = number(runStats.failed_runs) === 0 ? "HEALTHY" : "CHECK";

  return (
    <AppShell active="Research">
      <header>
        <div>
          <p className="eyebrow">SELF-SUFFICIENT PROSPECTING</p>
          <h1>ArborLine Research</h1>
          <p className="muted">Live visibility into public company discovery, decision-maker research, confidence quality, and the verification backlog. Discovery can research prospects, but it cannot send outreach.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link className="button" href="/prospects?lane=review">Review prospects</Link>
          <Link className="button" href="/campaigns">Campaigns</Link>
        </div>
      </header>

      <section className="grid stats">
        <article className="card"><p>Companies discovered</p><h2>{number(runStats.discovered)}</h2><small>Public-source candidates found in the last 24 hours</small></article>
        <article className="card"><p>New prospects</p><h2>{number(runStats.inserted)}</h2><small>{number(runStats.duplicates)} duplicates prevented</small></article>
        <article className="card"><p>High-confidence decision-makers</p><h2>{number(prospectStats.high_confidence_decision_makers)}</h2><small>85+ confidence required for contact-field promotion</small></article>
        <article className="card"><p>Research backlog</p><h2>{number(backlog.research_backlog)}</h2><small>{number(backlog.never_researched)} have not received a website-research pass yet</small></article>
        <article className="card"><p>Discovery safety</p><h2>{number(prospectStats.outreach_ready) === 0 ? "SAFE" : "CHECK"}</h2><small>{number(prospectStats.outreach_ready)} recent self-discovered prospects currently beyond NOT READY</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">24/7 ENGINE</p><h3>Discovery scheduler</h3></div>
          <span className="status">{sourceHealth}</span>
        </div>
        <div className="health">
          <div><span>Cadence</span><b>Hourly at :17</b></div>
          <div><span>Last discovery run</span><b>{latestRun ? formatCt(latestRun.started_at) : "No run yet"}</b></div>
          <div><span>Next discovery run</span><b>{formatCt(nextRun)}</b></div>
          <div><span>Current rotation</span><b>{latestRun ? `${latestRun.segment_name || latestPayload.segment || "Segment"} · ${latestPayload.geography || "Geography"}` : "Waiting for first run"}</b></div>
          <div><span>Rotation slot</span><b>{latestPayload.slotIndex !== undefined ? `${number(latestPayload.slotIndex) + 1} of ${number(latestPayload.slotCount) || "?"}` : "—"}</b></div>
          <div><span>Completed runs</span><b>{number(runStats.completed_runs)} / {number(runStats.runs)} in 24h</b></div>
          <div><span>Failed runs</span><b>{number(runStats.failed_runs)}</b></div>
          <div><span>Outreach separation</span><b>ENFORCED</b></div>
        </div>
      </section>

      <section className="split" style={{ marginBottom: 12 }}>
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">QUALIFICATION</p><h3>Discovery quality</h3></div><span className="status">Last 24h</span></div>
          <div className="health">
            <div><span>Inserted prospects</span><b>{number(prospectStats.prospects)}</b></div>
            <div><span>Qualified</span><b>{number(prospectStats.qualified)}</b></div>
            <div><span>Needs review</span><b>{number(prospectStats.review)}</b></div>
            <div><span>Website researched</span><b>{number(prospectStats.researched)}</b></div>
          </div>
        </article>
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">CONTACT INTELLIGENCE</p><h3>Email candidate pipeline</h3></div><span className="status">Verification gated</span></div>
          <div className="health">
            <div><span>Published email candidates</span><b>{number(prospectStats.published_email_candidates)}</b></div>
            <div><span>Inferred email candidates</span><b>{number(prospectStats.inferred_email_candidates)}</b></div>
            <div><span>Published waiting verification</span><b>{number(backlog.published_waiting_verification)}</b></div>
            <div><span>Inferred waiting verification</span><b>{number(backlog.inferred_waiting_verification)}</b></div>
          </div>
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>Published and inferred addresses remain research evidence only. They are not promoted into the send-ready contact field until the verification gate passes.</p>
        </article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">RECENT DISCOVERIES</p><h3>What ArborLine is finding</h3></div><span className="badge">{prospectsResult.rows.length} SHOWN</span></div>
        {prospectsResult.rows.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Company</th><th>Segment</th><th>Fit</th><th>Decision-maker research</th><th>Email research</th><th>Safety</th><th>Open</th></tr></thead>
              <tbody>
                {prospectsResult.rows.map((row) => {
                  const grade = row.decision_maker_confidence_grade;
                  return (
                    <tr key={row.id}>
                      <td><strong>{row.company_name}</strong><div className="muted">{[row.city,row.state].filter(Boolean).join(", ") || "Location pending"}</div><div className="muted">{row.domain || "Domain missing"}</div></td>
                      <td>{row.segment_name || "—"}</td>
                      <td><strong>{row.qualification_score ?? 0}/100</strong><div className="muted">{label(row.qualification_status)}</div></td>
                      <td>
                        {row.contact_name ? <strong>{row.contact_name}</strong> : <span className="muted">No promoted contact</span>}
                        <div className="muted">{row.contact_title || label(row.research_status)}</div>
                        {grade ? <div style={{ marginTop: 6 }}><span className={confidenceClass(grade)}>{grade} · {number(row.decision_maker_confidence)}%</span></div> : null}
                      </td>
                      <td><span className="status">{label(row.email_status || "NONE")}</span></td>
                      <td><span className="status">{label(row.outreach_status)}</span></td>
                      <td><Link className="tableLink" href={`/prospects/${row.id}`}>View →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No ArborLine-discovered prospects yet.</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">DISCOVERY RUN HISTORY</p><h3>Recent hourly cycles</h3></div><span className="status">Public sources</span></div>
        {runsResult.rows.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Started</th><th>Segment / geography</th><th>Status</th><th>Discovered</th><th>Inserted</th><th>Duplicates</th><th>Qualified</th></tr></thead>
              <tbody>{runsResult.rows.map((run) => {
                const payload = run.request_payload && typeof run.request_payload === "object" ? run.request_payload : {};
                return <tr key={run.id}>
                  <td>{formatCt(run.started_at)}</td>
                  <td><strong>{run.segment_name || payload.segment || "—"}</strong><div className="muted">{payload.geography || "—"}</div></td>
                  <td><span className="status">{label(run.status)}</span>{run.error_message ? <div className="muted">{String(run.error_message).slice(0, 120)}</div> : null}</td>
                  <td>{number(run.discovered_count)}</td>
                  <td>{number(run.inserted_count)}</td>
                  <td>{number(run.duplicate_count)}</td>
                  <td>{number(run.qualified_count)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <div className="empty">No public discovery runs recorded yet.</div>}
      </section>
    </AppShell>
  );
}
