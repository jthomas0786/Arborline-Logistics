import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function percent(value: number) {
  return `${Math.round(value)}%`;
}

function formatWhen(value: unknown, timezone?: string | null) {
  if (!value) return "Not scheduled";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "America/Chicago",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function actionHref(item: Record<string, unknown>) {
  const itemType = String(item.item_type || "");
  if (itemType === "CLIENT" || itemType === "REQUEST") return `/clients/${String(item.client_id)}`;
  if (item.prospect_id) return `/prospects/${String(item.prospect_id)}`;
  return "/appointments";
}

function actionSeverity(item: Record<string, unknown>) {
  const itemType = String(item.item_type || "");
  const status = String(item.status || "");
  if (itemType === "FOLLOW_UP" || status === "NO_SHOW") return "high";
  if (itemType === "REQUEST" || itemType === "CLIENT" || itemType === "PROSPECT_REVIEW") return "review";
  if (itemType === "QUALIFIED") return "docs";
  return "review";
}

export default async function OperationsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();

  const [overviewResult, actionResult, upcomingResult, followUpResult, activityResult, portfolioResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*)::int FROM connect_clients WHERE status='ACTIVE') AS active_clients,
        (SELECT count(*)::int FROM connect_clients WHERE billing_status='ACTIVE') AS paying_clients,
        (SELECT count(*)::int FROM connect_clients WHERE status='ONBOARDING' OR onboarding_completed_at IS NULL) AS onboarding_clients,
        (SELECT count(*)::int FROM connect_client_requests WHERE status IN ('SUBMITTED','IN_REVIEW')) AS open_requests,
        (SELECT count(*)::int FROM connect_prospects WHERE qualification_status='REVIEW') AS review_prospects,
        (SELECT count(*)::int
           FROM connect_prospects p
          WHERE p.qualification_status='QUALIFIED'
            AND p.outreach_status NOT IN ('BOOKED','STOPPED')
            AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id)) AS qualified_attention,
        (SELECT count(*)::int FROM connect_handoffs WHERE status IN ('READY_FOR_REVIEW','SCHEDULING')) AS attention_handoffs,
        (SELECT count(*)::int FROM connect_handoffs WHERE status='SCHEDULED' AND scheduled_for >= now()) AS upcoming_handoffs,
        (SELECT count(*)::int FROM connect_handoffs WHERE status='NO_SHOW') AS no_shows,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_outcome='FOLLOW_UP_NEEDED') AS follow_ups,
        (SELECT count(*)::int FROM connect_prospects WHERE qualification_status='QUALIFIED') AS qualified,
        (SELECT count(*)::int FROM connect_handoffs) AS handoffs,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_outcome='ESTIMATE_SENT') AS estimates,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_outcome='WON') AS wins,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_outcome='LOST') AS losses,
        (SELECT COALESCE(sum(estimated_monthly_value),0)::numeric FROM connect_handoffs WHERE client_outcome='ESTIMATE_SENT') AS estimate_mrr,
        (SELECT COALESCE(sum(estimated_monthly_value),0)::numeric FROM connect_handoffs WHERE client_outcome='WON') AS won_mrr
    `),
    pool.query(`
      SELECT * FROM (
        SELECT
          'CLIENT'::text AS item_type,
          c.id AS item_id,
          c.id AS client_id,
          c.company_name AS client_name,
          NULL::uuid AS prospect_id,
          c.status::text AS status,
          c.company_name::text AS title,
          CASE
            WHEN c.status='ONBOARDING' THEN 'Client onboarding is still in progress.'
            WHEN c.onboarding_completed_at IS NULL THEN 'Customer onboarding/setup has not been completed yet.'
            ELSE 'Client setup needs review.'
          END::text AS detail,
          c.updated_at AS happened_at,
          0 AS priority
        FROM connect_clients c
        WHERE c.status='ONBOARDING' OR c.onboarding_completed_at IS NULL

        UNION ALL

        SELECT
          'REQUEST'::text AS item_type,
          r.id AS item_id,
          r.client_id,
          c.company_name AS client_name,
          NULL::uuid AS prospect_id,
          r.status::text AS status,
          r.category::text AS title,
          left(r.message,240)::text AS detail,
          r.created_at AS happened_at,
          CASE r.status WHEN 'SUBMITTED' THEN 0 ELSE 1 END AS priority
        FROM connect_client_requests r
        JOIN connect_clients c ON c.id=r.client_id
        WHERE r.status IN ('SUBMITTED','IN_REVIEW')

        UNION ALL

        SELECT
          'PROSPECT_REVIEW'::text AS item_type,
          p.id AS item_id,
          p.client_id,
          c.company_name AS client_name,
          p.id AS prospect_id,
          p.qualification_status::text AS status,
          p.company_name::text AS title,
          ('Qualification review · score ' || COALESCE(p.qualification_score::text,'—') || '/100')::text AS detail,
          p.updated_at AS happened_at,
          1 AS priority
        FROM connect_prospects p
        JOIN connect_clients c ON c.id=p.client_id
        WHERE p.qualification_status='REVIEW'

        UNION ALL

        SELECT
          'QUALIFIED'::text AS item_type,
          p.id AS item_id,
          p.client_id,
          c.company_name AS client_name,
          p.id AS prospect_id,
          p.qualification_status::text AS status,
          p.company_name::text AS title,
          ('Qualified at ' || COALESCE(p.qualification_score::text,'—') || '/100 · outreach ' || lower(replace(p.outreach_status,'_',' ')))::text AS detail,
          p.updated_at AS happened_at,
          1 AS priority
        FROM connect_prospects p
        JOIN connect_clients c ON c.id=p.client_id
        WHERE p.qualification_status='QUALIFIED'
          AND p.outreach_status NOT IN ('BOOKED','STOPPED')
          AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id)

        UNION ALL

        SELECT
          'HANDOFF'::text AS item_type,
          h.id AS item_id,
          h.client_id,
          c.company_name AS client_name,
          h.prospect_id,
          h.status::text AS status,
          COALESCE(h.company_name,'Qualified handoff')::text AS title,
          left(COALESCE(h.suggested_next_step,h.summary,'Qualified handoff needs staff review.'),240)::text AS detail,
          h.created_at AS happened_at,
          0 AS priority
        FROM connect_handoffs h
        JOIN connect_clients c ON c.id=h.client_id
        WHERE h.status IN ('READY_FOR_REVIEW','SCHEDULING')

        UNION ALL

        SELECT
          'FOLLOW_UP'::text AS item_type,
          h.id AS item_id,
          h.client_id,
          c.company_name AS client_name,
          h.prospect_id,
          COALESCE(h.client_outcome,h.status)::text AS status,
          COALESCE(h.company_name,'Qualified handoff')::text AS title,
          left(COALESCE(h.outcome_notes,h.notes,'Customer follow-up needs attention.'),240)::text AS detail,
          COALESCE(h.outcome_updated_at,h.updated_at) AS happened_at,
          0 AS priority
        FROM connect_handoffs h
        JOIN connect_clients c ON c.id=h.client_id
        WHERE h.client_outcome='FOLLOW_UP_NEEDED' OR h.status='NO_SHOW'
      ) queue
      ORDER BY priority ASC,happened_at ASC NULLS LAST
      LIMIT 16
    `),
    pool.query(`
      SELECT h.id,h.client_id,h.prospect_id,h.company_name,h.contact_name,h.booking_type,
             h.scheduled_for,h.meeting_url,h.notes,c.company_name AS client_name,c.timezone
      FROM connect_handoffs h
      JOIN connect_clients c ON c.id=h.client_id
      WHERE h.status='SCHEDULED'
      ORDER BY CASE WHEN h.scheduled_for >= now() THEN 0 ELSE 1 END,
               h.scheduled_for ASC NULLS LAST
      LIMIT 10
    `),
    pool.query(`
      SELECT h.id,h.client_id,h.prospect_id,h.company_name,h.contact_name,h.booking_type,h.status,
             h.client_outcome,h.estimated_monthly_value,h.outcome_notes,h.outcome_updated_at,h.updated_at,
             c.company_name AS client_name
      FROM connect_handoffs h
      JOIN connect_clients c ON c.id=h.client_id
      WHERE h.client_outcome='FOLLOW_UP_NEEDED' OR h.status='NO_SHOW'
      ORDER BY COALESCE(h.outcome_updated_at,h.updated_at) DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT * FROM (
        SELECT
          'REQUEST'::text AS activity_type,
          r.id AS activity_id,
          r.client_id,
          NULL::uuid AS prospect_id,
          c.company_name AS client_name,
          (replace(r.category,'_',' ') || ' request submitted')::text AS title,
          left(r.message,220)::text AS detail,
          r.created_at AS happened_at
        FROM connect_client_requests r
        JOIN connect_clients c ON c.id=r.client_id

        UNION ALL

        SELECT
          'OUTCOME'::text AS activity_type,
          h.id AS activity_id,
          h.client_id,
          h.prospect_id,
          c.company_name AS client_name,
          (replace(COALESCE(h.client_outcome,h.status),'_',' ') || ' reported')::text AS title,
          left(COALESCE(h.outcome_notes,h.company_name,'Customer updated a handoff outcome.'),220)::text AS detail,
          COALESCE(h.outcome_updated_at,h.updated_at) AS happened_at
        FROM connect_handoffs h
        JOIN connect_clients c ON c.id=h.client_id
        WHERE h.client_outcome IS NOT NULL OR h.status='NO_SHOW'

        UNION ALL

        SELECT
          'PORTAL'::text AS activity_type,
          i.id AS activity_id,
          i.client_id,
          NULL::uuid AS prospect_id,
          c.company_name AS client_name,
          'Portal access claimed'::text AS title,
          ('Customer portal access activated for ' || i.email)::text AS detail,
          i.claimed_at AS happened_at
        FROM connect_client_invites i
        JOIN connect_clients c ON c.id=i.client_id
        WHERE i.claimed_at IS NOT NULL

        UNION ALL

        SELECT
          'ONBOARDING'::text AS activity_type,
          c.id AS activity_id,
          c.id AS client_id,
          NULL::uuid AS prospect_id,
          c.company_name AS client_name,
          'Customer onboarding completed'::text AS title,
          'Account setup and customer onboarding were completed.'::text AS detail,
          c.onboarding_completed_at AS happened_at
        FROM connect_clients c
        WHERE c.onboarding_completed_at IS NOT NULL
      ) activity
      ORDER BY happened_at DESC NULLS LAST
      LIMIT 14
    `),
    pool.query(`
      SELECT c.id,c.company_name,c.status,c.billing_status,c.onboarding_completed_at,
             COALESCE(p.qualified,0)::int AS qualified,
             COALESCE(p.review_prospects,0)::int AS review_prospects,
             COALESCE(p.qualified_attention,0)::int AS qualified_attention,
             COALESCE(r.open_requests,0)::int AS open_requests,
             COALESCE(h.handoffs,0)::int AS handoffs,
             COALESCE(h.attention_handoffs,0)::int AS attention_handoffs,
             COALESCE(h.upcoming_handoffs,0)::int AS upcoming_handoffs,
             COALESCE(h.follow_ups,0)::int AS follow_ups,
             COALESCE(h.no_shows,0)::int AS no_shows,
             COALESCE(h.estimates,0)::int AS estimates,
             COALESCE(h.wins,0)::int AS wins,
             COALESCE(h.losses,0)::int AS losses,
             COALESCE(h.estimate_mrr,0)::numeric AS estimate_mrr,
             COALESCE(h.won_mrr,0)::numeric AS won_mrr
      FROM connect_clients c
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE p.qualification_status='QUALIFIED') AS qualified,
          count(*) FILTER (WHERE p.qualification_status='REVIEW') AS review_prospects,
          count(*) FILTER (
            WHERE p.qualification_status='QUALIFIED'
              AND p.outreach_status NOT IN ('BOOKED','STOPPED')
              AND NOT EXISTS (SELECT 1 FROM connect_handoffs hx WHERE hx.prospect_id=p.id)
          ) AS qualified_attention
        FROM connect_prospects p
        WHERE p.client_id=c.id
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE r.status IN ('SUBMITTED','IN_REVIEW')) AS open_requests
        FROM connect_client_requests r
        WHERE r.client_id=c.id
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS handoffs,
          count(*) FILTER (WHERE h.status IN ('READY_FOR_REVIEW','SCHEDULING')) AS attention_handoffs,
          count(*) FILTER (WHERE h.status='SCHEDULED' AND h.scheduled_for >= now()) AS upcoming_handoffs,
          count(*) FILTER (WHERE h.client_outcome='FOLLOW_UP_NEEDED') AS follow_ups,
          count(*) FILTER (WHERE h.status='NO_SHOW') AS no_shows,
          count(*) FILTER (WHERE h.client_outcome='ESTIMATE_SENT') AS estimates,
          count(*) FILTER (WHERE h.client_outcome='WON') AS wins,
          count(*) FILTER (WHERE h.client_outcome='LOST') AS losses,
          COALESCE(sum(h.estimated_monthly_value) FILTER (WHERE h.client_outcome='ESTIMATE_SENT'),0) AS estimate_mrr,
          COALESCE(sum(h.estimated_monthly_value) FILTER (WHERE h.client_outcome='WON'),0) AS won_mrr
        FROM connect_handoffs h
        WHERE h.client_id=c.id
      ) h ON true
      ORDER BY
        CASE WHEN c.status='ONBOARDING' OR c.onboarding_completed_at IS NULL THEN 0 ELSE 1 END,
        CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'READY' THEN 1 WHEN 'ONBOARDING' THEN 2 ELSE 3 END,
        c.company_name
    `)
  ]);

  const overview = overviewResult.rows[0] || {};
  const payingClients = Number(overview.paying_clients || 0);
  const wonMrr = Number(overview.won_mrr || 0);
  const estimateMrr = Number(overview.estimate_mrr || 0);
  const monthlyFeeBase = payingClients * 750;
  const revenueMultiple = monthlyFeeBase > 0 ? wonMrr / monthlyFeeBase : 0;
  const revenueRoi = monthlyFeeBase > 0 ? ((wonMrr - monthlyFeeBase) / monthlyFeeBase) * 100 : 0;
  const opportunityAttention = Number(overview.review_prospects || 0) + Number(overview.qualified_attention || 0);
  const followUpAttention = Number(overview.follow_ups || 0) + Number(overview.no_shows || 0);

  return <AppShell active="Dashboard">
    <header>
      <div>
        <p className="eyebrow">ARBORLINE CONNECT</p>
        <h1>Command Center</h1>
        <p className="muted">Day-to-day operating view across customer setup, requests, qualified opportunities, handoffs, outcomes, and revenue ROI.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
        <a className="button" href="/clients">Clients</a>
        <a className="button" href="/appointments">Appointments</a>
      </div>
    </header>

    <section className="grid stats">
      <article className="card"><p>Needs onboarding</p><h2>{overview.onboarding_clients ?? 0}</h2><small>Accounts still needing customer setup or staff review</small></article>
      <article className="card"><p>Customer requests</p><h2>{overview.open_requests ?? 0}</h2><small>Submitted or in-review targeting/account changes</small></article>
      <article className="card"><p>Opportunity attention</p><h2>{opportunityAttention}</h2><small>{overview.review_prospects ?? 0} review · {overview.qualified_attention ?? 0} qualified without handoff</small></article>
      <article className="card"><p>Coming up</p><h2>{overview.upcoming_handoffs ?? 0}</h2><small>Scheduled qualified conversations</small></article>
      <article className="card"><p>Follow-up / no-show</p><h2>{followUpAttention}</h2><small>{overview.follow_ups ?? 0} follow-up · {overview.no_shows ?? 0} no-show</small></article>
      <article className="card"><p>Open estimate value</p><h2>{money(estimateMrr)}</h2><small>{overview.estimates ?? 0} customer-reported estimates</small></article>
      <article className="card"><p>Won monthly value</p><h2>{money(wonMrr)}</h2><small>{overview.wins ?? 0} client-reported wins</small></article>
      <article className="card"><p>Portfolio revenue multiple</p><h2>{monthlyFeeBase > 0 ? `${revenueMultiple.toFixed(1)}×` : "—"}</h2><small>{payingClients} active-billing client{payingClients === 1 ? "" : "s"}</small></article>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">ACTION QUEUE</p><h3>What needs staff attention</h3></div><span className="badge">{actionResult.rows.length} SHOWN</span></div>
        {actionResult.rows.length ? actionResult.rows.map((item) => <div className="exception" key={`${item.item_type}-${item.item_id}`}>
          <span className={`severity ${actionSeverity(item)}`}>{label(item.item_type)}</span>
          <div className="grow">
            <strong>{item.item_type === "REQUEST" ? `${label(item.title)} request` : item.title}</strong>
            <p>{item.client_name} · {label(item.status)}</p>
            <p>{item.detail}</p>
            <small className="muted">{item.happened_at ? new Date(item.happened_at).toLocaleString() : ""}</small>
          </div>
          <a className="button" href={actionHref(item)}>Open</a>
        </div>) : <div className="empty">Nothing needs staff attention right now.</div>}
      </article>

      <aside className="panel">
        <div className="panelHead"><div><p className="eyebrow">PORTFOLIO ROI</p><h3>Qualified → Handoffs → Estimates → Wins</h3></div><span className="badge">REVENUE ROI</span></div>
        <div className="health">
          <div><span>Active clients</span><b>{overview.active_clients ?? 0}</b></div>
          <div><span>Qualified opportunities</span><b>{overview.qualified ?? 0}</b></div>
          <div><span>Qualified handoffs</span><b>{overview.handoffs ?? 0}</b></div>
          <div><span>Estimates sent</span><b>{overview.estimates ?? 0}</b></div>
          <div><span>Wins</span><b>{overview.wins ?? 0}</b></div>
          <div><span>Losses</span><b>{overview.losses ?? 0}</b></div>
        </div>
        <div className="autopilot">
          <span>WON RECURRING MONTHLY VALUE</span>
          <strong>{money(wonMrr)}</strong>
          <div className="health">
            <div><span>Active-billing fee base</span><b>{money(monthlyFeeBase)}/mo</b></div>
            <div><span>Revenue multiple</span><b>{monthlyFeeBase > 0 ? `${revenueMultiple.toFixed(1)}×` : "—"}</b></div>
            <div><span>Revenue ROI</span><b>{monthlyFeeBase > 0 ? percent(revenueRoi) : "—"}</b></div>
          </div>
          <small>Revenue ROI compares customer-reported recurring monthly value from won opportunities with the $750/month Founding Client fee. It is not profit ROI.</small>
        </div>
      </aside>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">COMING UP</p><h3>Scheduled appointments and handoffs</h3></div><a className="button" href="/appointments">All appointments</a></div>
        {upcomingResult.rows.length ? upcomingResult.rows.map((row) => {
          const overdue = row.scheduled_for && new Date(row.scheduled_for).getTime() < Date.now();
          return <div className="exception" key={row.id}>
            <span className={`severity ${overdue ? "high" : "docs"}`}>{overdue ? "PAST DUE" : label(row.booking_type)}</span>
            <div className="grow">
              <strong>{row.company_name || "Qualified handoff"}{row.contact_name ? ` · ${row.contact_name}` : ""}</strong>
              <p>{row.client_name} · {formatWhen(row.scheduled_for,row.timezone)}</p>
              {row.notes ? <p>{row.notes}</p> : null}
            </div>
            <a className="button" href={`/prospects/${row.prospect_id}`}>Prospect</a>
          </div>;
        }) : <div className="empty">No appointments are currently scheduled.</div>}
      </article>

      <aside className="panel">
        <div className="panelHead"><div><p className="eyebrow">FOLLOW-UP WATCH</p><h3>No-shows and follow-up needed</h3></div><span className="badge">{followUpResult.rows.length} SHOWN</span></div>
        {followUpResult.rows.length ? followUpResult.rows.map((row) => <div className="exception" key={row.id}>
          <span className="severity high">{label(row.client_outcome || row.status)}</span>
          <div className="grow">
            <strong>{row.company_name || "Qualified handoff"}</strong>
            <p>{row.client_name}{row.contact_name ? ` · ${row.contact_name}` : ""}</p>
            {row.outcome_notes ? <p>{row.outcome_notes}</p> : null}
            <small className="muted">{row.estimated_monthly_value ? `${money(row.estimated_monthly_value)}/mo · ` : ""}{row.outcome_updated_at ? new Date(row.outcome_updated_at).toLocaleString() : ""}</small>
          </div>
          <a className="button" href={`/prospects/${row.prospect_id}`}>Open</a>
        </div>) : <div className="empty">No no-shows or follow-up-needed outcomes are open.</div>}
      </aside>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">RECENT CUSTOMER ACTIVITY</p><h3>Meaningful updates across all clients</h3></div><span className="badge">{activityResult.rows.length} RECENT</span></div>
      {activityResult.rows.length ? activityResult.rows.map((row) => <div className="exception" key={`${row.activity_type}-${row.activity_id}`}>
        <span className={`severity ${row.activity_type === "OUTCOME" ? "docs" : row.activity_type === "REQUEST" ? "review" : ""}`}>{label(row.activity_type)}</span>
        <div className="grow">
          <strong>{label(row.title)}</strong>
          <p>{row.client_name} · {row.detail}</p>
          <small className="muted">{row.happened_at ? new Date(row.happened_at).toLocaleString() : ""}</small>
        </div>
        <a className="button" href={row.prospect_id ? `/prospects/${row.prospect_id}` : `/clients/${row.client_id}`}>Open</a>
      </div>) : <div className="empty">Customer requests, portal activation, onboarding completion, and reported outcomes will appear here.</div>}
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">CLIENT PORTFOLIO</p><h3>Every Connect customer in one operating view</h3></div><span className="badge">{portfolioResult.rows.length} CLIENTS</span></div>
      {portfolioResult.rows.length ? <div className="tableWrap"><table>
        <thead><tr><th>Client</th><th>Status</th><th>Opportunity attention</th><th>Requests / handoffs</th><th>Upcoming</th><th>Follow-up / no-show</th><th>Estimates</th><th>Wins / losses</th><th>Open estimate value</th><th>Won monthly value</th><th>Revenue multiple</th><th>Revenue ROI</th><th></th></tr></thead>
        <tbody>{portfolioResult.rows.map((client) => {
          const clientWonMrr = Number(client.won_mrr || 0);
          const clientRevenueMultiple = client.billing_status === "ACTIVE" ? clientWonMrr / 750 : null;
          const clientRevenueRoi = client.billing_status === "ACTIVE" ? ((clientWonMrr - 750) / 750) * 100 : null;
          const onboardingNeeded = client.status === "ONBOARDING" || !client.onboarding_completed_at;
          return <tr key={client.id}>
            <td><strong>{client.company_name}</strong><div className="muted">Billing: {label(client.billing_status)}</div></td>
            <td><span className={`status ${onboardingNeeded ? "exception" : ""}`}>{onboardingNeeded ? "NEEDS ONBOARDING" : label(client.status)}</span></td>
            <td>{Number(client.review_prospects || 0) + Number(client.qualified_attention || 0)}<div className="muted">{client.review_prospects} review · {client.qualified_attention} qualified</div></td>
            <td>{Number(client.open_requests || 0) + Number(client.attention_handoffs || 0)}<div className="muted">{client.open_requests} req · {client.attention_handoffs} handoff</div></td>
            <td>{client.upcoming_handoffs}</td>
            <td>{Number(client.follow_ups || 0) + Number(client.no_shows || 0)}<div className="muted">{client.follow_ups} follow-up · {client.no_shows} no-show</div></td>
            <td>{client.estimates}</td>
            <td>{client.wins} / {client.losses}</td>
            <td>{money(client.estimate_mrr)}</td>
            <td><strong>{money(client.won_mrr)}</strong></td>
            <td>{clientRevenueMultiple === null ? "—" : `${clientRevenueMultiple.toFixed(1)}×`}</td>
            <td>{clientRevenueRoi === null ? "—" : percent(clientRevenueRoi)}</td>
            <td><a className="tableLink" href={`/clients/${client.id}`}>Open →</a></td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="empty">No Connect clients yet.</div>}
      <p className="muted" style={{marginTop:12,fontSize:11}}>Per-client revenue multiple and revenue ROI are shown for active-billing accounts and compare customer-reported won recurring monthly value with the $750/month Founding Client fee. They are revenue metrics, not profit metrics.</p>
    </section>
  </AppShell>;
}
