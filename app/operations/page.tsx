import type { CSSProperties } from "react";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import styles from "./operations.module.css";

export const dynamic = "force-dynamic";

type MetricTrend = {
  text: string;
  direction: "up" | "down" | "flat";
};

type ChartPoint = {
  bucket_end: Date | string;
  reached: number | string;
  meetings: number | string;
};

function compactNumber(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    notation: Number(value || 0) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(Number(value || 0));
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Number(value || 0) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Number(value || 0) >= 1000 ? 1 : 0
  }).format(Number(value || 0));
}

function trend(currentValue: unknown, previousValue: unknown): MetricTrend {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (previous <= 0) {
    if (current > 0) return { text: "NEW", direction: "up" };
    return { text: "—", direction: "flat" };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: "0%", direction: "flat" };
  return {
    text: `${change > 0 ? "+" : ""}${Math.round(change)}%`,
    direction: change > 0 ? "up" : "down"
  };
}

function formatRelative(value: unknown) {
  if (!value) return "";
  const ms = Math.max(0, Date.now() - new Date(String(value)).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildPath(values: number[], max: number) {
  const width = 500;
  const top = 8;
  const bottom = 146;
  if (!values.length) return "";
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const ratio = max > 0 ? value / max : 0;
    const y = bottom - ratio * (bottom - top);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function Chart({ points }: { points: ChartPoint[] }) {
  const reached = points.map((point) => Number(point.reached || 0));
  const meetings = points.map((point) => Number(point.meetings || 0));
  const maxValue = Math.max(1, ...reached, ...meetings);
  const chartMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const reachedPath = buildPath(reached, chartMax);
  const meetingPath = buildPath(meetings, chartMax);
  const yLabels = [chartMax, chartMax * 0.75, chartMax * 0.5, chartMax * 0.25, 0];
  const xLabels = points.map((point) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(String(point.bucket_end)))
  );

  return <div className={styles.chartWrap}>
    <div className={styles.yLabels}>
      {yLabels.map((value) => <span key={value}>{compactNumber(value)}</span>)}
    </div>
    <div className={styles.chartCanvas}>
      <svg className={styles.chartSvg} viewBox="0 0 500 154" role="img" aria-label="Reached and meetings trend">
        <defs>
          <linearGradient id="reachedFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2496ff" stopOpacity=".32"/>
            <stop offset="100%" stopColor="#2496ff" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="meetingFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1bd8e8" stopOpacity=".22"/>
            <stop offset="100%" stopColor="#1bd8e8" stopOpacity="0"/>
          </linearGradient>
          <filter id="blueGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        {[8, 42.5, 77, 111.5, 146].map((y) =>
          <line key={y} x1="0" x2="500" y1={y} y2={y} className={styles.gridLine}/>
        )}
        {points.map((_, index) => {
          const x = points.length === 1 ? 250 : (index / Math.max(1, points.length - 1)) * 500;
          return <line key={index} x1={x} x2={x} y1="8" y2="146" className={styles.gridLine}/>;
        })}
        {reachedPath ? <path d={`${reachedPath} L 500 146 L 0 146 Z`} fill="url(#reachedFill)"/> : null}
        {meetingPath ? <path d={`${meetingPath} L 500 146 L 0 146 Z`} fill="url(#meetingFill)"/> : null}
        <path d={reachedPath} className={styles.reachedLine} filter="url(#blueGlow)"/>
        <path d={meetingPath} className={styles.meetingLine}/>
        {reached.map((value, index) => {
          const x = reached.length === 1 ? 250 : (index / Math.max(1, reached.length - 1)) * 500;
          const y = 146 - (value / chartMax) * 138;
          return <circle key={`r-${index}`} cx={x} cy={y} r="2.6" className={styles.reachedPoint}/>;
        })}
        {meetings.map((value, index) => {
          const x = meetings.length === 1 ? 250 : (index / Math.max(1, meetings.length - 1)) * 500;
          const y = 146 - (value / chartMax) * 138;
          return <circle key={`m-${index}`} cx={x} cy={y} r="2.2" className={styles.meetingPoint}/>;
        })}
      </svg>
      <div className={styles.xLabels}>
        {xLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
    </div>
  </div>;
}

function ActivityGlyph({ kind }: { kind: string }) {
  if (kind === "EMAIL") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h17v11h-17z"/><path d="m4 7 8 6 8-6"/></svg>;
  if (kind === "MEETING") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><path d="m9 14 2 2 4-4"/></svg>;
  if (kind === "REPLY") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M5 12h8c4 0 6 2 6 6"/></svg>;
  if (kind === "SAMPLE") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>;
  if (kind === "DRAFT") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M7 16l9-9 2 2-9 9-3 1z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 20c.5-4 3.2-6 8-6s7.5 2 8 6"/><path d="M18 5v5M15.5 7.5h5"/></svg>;
}

function WorkflowGlyph({ kind }: { kind: "prospect" | "outreach" | "sequence" | "analytics" }) {
  if (kind === "outreach") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 8h22v16H5z"/><path d="m6 9 10 8 10-8"/></svg>;
  if (kind === "sequence") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 16 27 6l-7 21-5-8-10-3z"/><path d="m15 19 5-5"/></svg>;
  if (kind === "analytics") return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25V15M14 25V10M21 25V18M28 25V6"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="11" r="4"/><circle cx="22" cy="12" r="3.5"/><path d="M4 25c.4-6 3-9 7-9s6.5 3 7 9M17 25c.2-4 2-7 5-7s5 2 6 7"/></svg>;
}

function NavGlyph({ kind }: { kind: string }) {
  if (kind === "Dashboard") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7"/><path d="M6 10v10h12V10M10 20v-6h4v6"/></svg>;
  if (kind === "Prospects") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.4-5 2.6-7.5 6-7.5s5.6 2.5 6 7.5M14 14c3.7 0 6 2 6.5 6"/></svg>;
  if (kind === "Outreach") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 21 3l-6 18-4-7-8-3z"/><path d="m11 14 4-4"/></svg>;
  if (kind === "Research") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4-8 4-8-4 8-4z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></svg>;
  if (kind === "Analytics") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9M9 20V4M14 20v-7M19 20V7"/></svg>;
  if (kind === "Appointments") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m9 15 2 2 4-4"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20V8l6-4 6 4v12"/><path d="M9 11h2M13 11h2M9 15h2M13 15h2"/></svg>;
}

const dashboardNav = [
  ["Dashboard","/operations"],
  ["Prospects","/prospects"],
  ["Outreach","/campaigns"],
  ["Research","/research"],
  ["Analytics","/growth"],
  ["Appointments","/appointments"],
  ["Clients","/clients"]
] as const;

export default async function OperationsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();

  const [metricsResult, chartResult, activityResult, pipelineResult] = await Promise.all([
    pool.query(`
      WITH bounds AS (
        SELECT now() - interval '30 days' AS start_at, now() - interval '60 days' AS previous_start_at
      )
      SELECT
        (SELECT count(*)::int FROM connect_outreach_messages m,bounds b WHERE m.status IN ('SENT','DELIVERED') AND COALESCE(m.sent_at,m.created_at) >= b.start_at) AS reached,
        (SELECT count(*)::int FROM connect_outreach_messages m,bounds b WHERE m.status IN ('SENT','DELIVERED') AND COALESCE(m.sent_at,m.created_at) >= b.previous_start_at AND COALESCE(m.sent_at,m.created_at) < b.start_at) AS previous_reached,
        (SELECT count(*)::int FROM connect_replies r,bounds b WHERE COALESCE(r.received_at,r.created_at) >= b.start_at) AS replies,
        (SELECT count(*)::int FROM connect_replies r,bounds b WHERE COALESCE(r.received_at,r.created_at) >= b.previous_start_at AND COALESCE(r.received_at,r.created_at) < b.start_at) AS previous_replies,
        (SELECT count(*)::int FROM connect_handoffs h,bounds b WHERE h.created_at >= b.start_at) AS meetings,
        (SELECT count(*)::int FROM connect_handoffs h,bounds b WHERE h.created_at >= b.previous_start_at AND h.created_at < b.start_at) AS previous_meetings,
        (SELECT COALESCE(sum(h.estimated_monthly_value),0)::numeric FROM connect_handoffs h,bounds b WHERE h.created_at >= b.start_at) AS pipeline_value,
        (SELECT COALESCE(sum(h.estimated_monthly_value),0)::numeric FROM connect_handoffs h,bounds b WHERE h.created_at >= b.previous_start_at AND h.created_at < b.start_at) AS previous_pipeline_value,
        (SELECT count(*)::int FROM connect_prospect_segments WHERE status='ACTIVE') AS active_segments,
        (SELECT count(*)::int FROM connect_prospect_segments) AS total_segments
    `),
    pool.query(`
      WITH bounds AS (SELECT now() - interval '30 days' AS start_at),
      points AS (
        SELECT n,start_at + (n * interval '5 days') AS bucket_end,start_at
        FROM bounds,generate_series(1,6) AS n
      )
      SELECT bucket_end,
        (SELECT count(*)::int FROM connect_outreach_messages m WHERE m.status IN ('SENT','DELIVERED') AND COALESCE(m.sent_at,m.created_at) >= p.start_at AND COALESCE(m.sent_at,m.created_at) <= p.bucket_end) AS reached,
        (SELECT count(*)::int FROM connect_handoffs h WHERE h.created_at >= p.start_at AND h.created_at <= p.bucket_end) AS meetings
      FROM points p ORDER BY bucket_end
    `),
    pool.query(`
      WITH events AS (
        SELECT 'LEAD'::text AS activity_type,p.id::text AS activity_id,'New lead discovered'::text AS title,p.company_name::text AS detail,p.created_at AS happened_at FROM connect_prospects p
        UNION ALL
        SELECT 'EMAIL',m.id::text,'Email delivered',p.company_name::text,COALESCE(m.delivered_at,m.sent_at) FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.status IN ('DELIVERED','SENT')
        UNION ALL
        SELECT 'DRAFT',m.id::text,'Outreach draft ready',p.company_name::text,m.created_at FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.status='DRAFT'
        UNION ALL
        SELECT 'SAMPLE',m.id::text,'Samples page viewed',p.company_name::text,m.sample_viewed_at FROM connect_outreach_messages m JOIN connect_prospects p ON p.id=m.prospect_id WHERE m.sample_viewed_at IS NOT NULL
        UNION ALL
        SELECT 'REPLY',r.id::text,CASE WHEN upper(COALESCE(r.classification,'')) IN ('POSITIVE','INTERESTED') THEN 'Positive reply' ELSE 'Reply received' END,p.company_name::text,COALESCE(r.received_at,r.created_at) FROM connect_replies r LEFT JOIN connect_prospects p ON p.id=r.prospect_id
        UNION ALL
        SELECT 'MEETING',h.id::text,'Meeting booked',h.company_name::text,COALESCE(h.scheduled_for,h.created_at) FROM connect_handoffs h
      ), ranked AS (
        SELECT *,row_number() OVER (PARTITION BY activity_type ORDER BY happened_at DESC NULLS LAST) AS rn FROM events WHERE happened_at IS NOT NULL
      )
      SELECT activity_type,activity_id,title,detail,happened_at FROM ranked WHERE rn=1 ORDER BY happened_at DESC LIMIT 4
    `),
    pool.query(`
      WITH bounds AS (SELECT date_trunc('month',now()) AS start_at)
      SELECT
        (SELECT count(*)::int FROM connect_prospects p,bounds b WHERE p.created_at >= b.start_at) AS new_leads,
        (SELECT count(DISTINCT m.prospect_id)::int FROM connect_outreach_messages m,bounds b WHERE m.status IN ('SENT','DELIVERED') AND COALESCE(m.sent_at,m.created_at) >= b.start_at) AS contacted,
        (SELECT count(DISTINCT r.prospect_id)::int FROM connect_replies r,bounds b WHERE COALESCE(r.received_at,r.created_at) >= b.start_at) AS in_conversation,
        (SELECT count(*)::int FROM connect_handoffs h,bounds b WHERE h.created_at >= b.start_at) AS meetings,
        (SELECT count(*)::int FROM connect_handoffs h,bounds b WHERE h.client_outcome='WON' AND COALESCE(h.outcome_updated_at,h.updated_at) >= b.start_at) AS closed_won
    `)
  ]);

  const metrics = metricsResult.rows[0] || {};
  const pipeline = pipelineResult.rows[0] || {};
  const activeSegments = Number(metrics.active_segments || 0);
  const totalSegments = Math.max(1, Number(metrics.total_segments || 0));
  const automationPercent = Math.round((activeSegments / totalSegments) * 100);

  const metricCards = [
    { label: "People Reached", value: compactNumber(metrics.reached), trend: trend(metrics.reached,metrics.previous_reached) },
    { label: "Replies", value: compactNumber(metrics.replies), trend: trend(metrics.replies,metrics.previous_replies) },
    { label: "Meetings Booked", value: compactNumber(metrics.meetings), trend: trend(metrics.meetings,metrics.previous_meetings) },
    { label: "Pipeline Value", value: money(metrics.pipeline_value), trend: trend(metrics.pipeline_value,metrics.previous_pipeline_value) }
  ];

  const pipelineRows = [
    { label: "New Leads", value: pipeline.new_leads, tone: "blue" },
    { label: "Contacted", value: pipeline.contacted, tone: "sky" },
    { label: "In Conversation", value: pipeline.in_conversation, tone: "cyan" },
    { label: "Meetings", value: pipeline.meetings, tone: "purple" },
    { label: "Closed Won", value: pipeline.closed_won, tone: "green" }
  ];

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <a className={styles.brandMark} href="/operations" aria-label="ArborLine Connect dashboard">
        <img src="/icon.svg" alt="" width={64} height={64}/>
      </a>
      <nav className={styles.nav}>
        {dashboardNav.map(([label,href]) => <a className={label === "Dashboard" ? styles.navActive : ""} href={href} key={label}>
          <span className={styles.navIcon}><NavGlyph kind={label}/></span><span>{label}</span>
        </a>)}
      </nav>
      <form className={styles.signout} action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
    </aside>

    <section className={styles.content}>
      <div className={styles.dashboardRoot}>
        <div className={styles.topGrid}>
          <section className={`${styles.panel} ${styles.performancePanel}`}>
            <div className={styles.panelHeader}>
              <h1>Campaign Performance</h1>
              <div className={styles.rangeSelect} aria-label="Date range">Last 30 days <span>⌄</span></div>
            </div>

            <div className={styles.metrics}>
              {metricCards.map((metric) => <div className={styles.metric} key={metric.label}>
                <strong>{metric.value}</strong><span>{metric.label}</span>
                <em className={`${styles.trend} ${styles[metric.trend.direction]}`}>
                  {metric.trend.direction === "up" ? "▲ " : metric.trend.direction === "down" ? "▼ " : ""}{metric.trend.text}
                </em>
              </div>)}
            </div>

            <div className={styles.chartArea}>
              <Chart points={chartResult.rows}/>
              <div className={styles.legend}>
                <span><i className={styles.legendReached}/>Reached</span>
                <span><i className={styles.legendMeetings}/>Meetings</span>
              </div>
            </div>
          </section>

          <aside className={`${styles.panel} ${styles.activityPanel}`}>
            <div className={styles.activityTitle}><span className={styles.liveDot}/><h2>Live Activity</h2></div>
            <div className={styles.activityList}>
              {activityResult.rows.length ? activityResult.rows.map((item) =>
                <div className={styles.activityItem} key={`${item.activity_type}-${item.activity_id}`}>
                  <span className={`${styles.activityIcon} ${styles[`activity${item.activity_type}`] || ""}`}><ActivityGlyph kind={String(item.activity_type)}/></span>
                  <div><strong>{item.title}</strong><span>{item.detail || "ArborLine Connect"}</span><small>{formatRelative(item.happened_at)}</small></div>
                </div>
              ) : <div className={styles.emptyActivity}>New prospect, outreach, reply, and meeting events will appear here.</div>}
            </div>
            <a className={styles.activityLink} href="/growth">View all activity <span>→</span></a>
          </aside>
        </div>

        <div className={styles.bottomGrid}>
          <section className={`${styles.panel} ${styles.workflowPanel}`}>
            <h2>Workflow Automation</h2>
            <div className={styles.workflowBody}>
              <div className={styles.workflowTiles}>
                <a href="/sourcing" className={styles.workflowTile}><WorkflowGlyph kind="prospect"/><span>Auto<br/>Prospect</span></a>
                <a href="/campaigns" className={styles.workflowTile}><WorkflowGlyph kind="outreach"/><span>Personalize<br/>Outreach</span></a>
                <a href="/research" className={styles.workflowTile}><WorkflowGlyph kind="sequence"/><span>Trigger<br/>Sequences</span></a>
                <a href="/growth" className={styles.workflowTile}><WorkflowGlyph kind="analytics"/><span>Track &<br/>Optimize</span></a>
              </div>
              <div className={styles.automationStatus}>
                <div className={styles.ring} style={{"--progress": `${automationPercent * 3.6}deg`} as CSSProperties}><span>{automationPercent}%</span></div>
                <strong>Automation<br/>Active</strong><span className={styles.running}><i/>Running</span>
              </div>
            </div>
          </section>

          <aside className={`${styles.panel} ${styles.pipelinePanel}`}>
            <div className={styles.panelHeader}><h2>Pipeline</h2><div className={styles.rangeSelect}>This Month <span>⌄</span></div></div>
            <div className={styles.pipelineList}>
              {pipelineRows.map((row) => <div className={styles.pipelineRow} key={row.label}>
                <span><i className={styles[row.tone]}/>{row.label}</span><strong>{compactNumber(row.value)}</strong>
              </div>)}
            </div>
          </aside>
        </div>
      </div>
    </section>
  </main>;
}
