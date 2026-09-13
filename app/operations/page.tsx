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

export default async function OperationsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();

  const [overviewResult, actionResult, outcomeResult, portfolioResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*)::int FROM connect_clients WHERE status='ACTIVE') AS active_clients,
        (SELECT count(*)::int FROM connect_clients WHERE billing_status='ACTIVE') AS paying_clients,
        (SELECT count(*)::int FROM connect_client_requests WHERE status IN ('SUBMITTED','IN_REVIEW')) AS open_requests,
        (SELECT count(*)::int FROM connect_handoffs WHERE status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED')) AS attention_handoffs,
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
          'REQUEST'::text AS item_type,
          r.id AS item_id,
          r.client_id,
          c.company_name AS client_name,
          NULL::uuid AS prospect_id,
          r.status::text AS status,
          r.category::text AS title,
          r.message::text AS detail,
          r.created_at AS happened_at,
          CASE r.status WHEN 'SUBMITTED' THEN 0 ELSE 1 END AS priority
        FROM connect_client_requests r
        JOIN connect_clients c ON c.id=r.client_id
        WHERE r.status IN ('SUBMITTED','IN_REVIEW')

        UNION ALL

        SELECT
          'HANDOFF'::text AS item_type,
          h.id AS item_id,
          h.client_id,
          c.company_name AS client_name,
          h.prospect_id,
          h.status::text AS status,
          COALESCE(h.company_name,'Qualified handoff')::text AS title,
          COALESCE(h.suggested_next_step,h.summary,'Client follow-up needed')::text AS detail,
          COALESCE(h.scheduled_for,h.created_at) AS happened_at,
          CASE h.status WHEN 'READY_FOR_REVIEW' THEN 0 WHEN 'SCHEDULING' THEN 1 ELSE 2 END AS priority
        FROM connect_handoffs h
        JOIN connect_clients c ON c.id=h.client_id
        WHERE h.status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED')
      ) queue
      ORDER BY priority ASC,happened_at ASC
      LIMIT 12
    `),
    pool.query(`
      SELECT h.id,h.prospect_id,h.client_id,c.company_name AS client_name,
             h.company_name,h.contact_name,h.booking_type,h.status,h.client_outcome,
             h.estimated_monthly_value,h.outcome_notes,h.outcome_updated_at,h.updated_at
      FROM connect_handoffs h
      JOIN connect_clients c ON c.id=h.client_id
      WHERE h.client_outcome IN ('ESTIMATE_SENT','WON','LOST') OR h.status='NO_SHOW'
      ORDER BY COALESCE(h.outcome_updated_at,h.updated_at) DESC
      LIMIT 12
    `),
    pool.query(`
      SELECT c.id,c.company_name,c.status,c.billing_status,
             COALESCE(p.qualified,0)::int AS qualified,
             COALESCE(r.open_requests,0)::int AS open_requests,
             COALESCE(h.handoffs,0)::int AS handoffs,
             COALESCE(h.attention_handoffs,0)::int AS attention_handoffs,
             COALESCE(h.estimates,0)::int AS estimates,
             COALESCE(h.wins,0)::int AS wins,
             COALESCE(h.losses,0)::int AS losses,
             COALESCE(h.estimate_mrr,0)::numeric AS estimate_mrr,
             COALESCE(h.won_mrr,0)::numeric AS won_mrr
      FROM connect_clients c
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE qualification_status='QUALIFIED') AS qualified
        FROM connect_prospects p
        WHERE p.client_id=c.id
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE status IN ('SUBMITTED','IN_REVIEW')) AS open_requests
        FROM connect_client_requests r
        WHERE r.client_id=c.id
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS handoffs,
          count(*) FILTER (WHERE status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED')) AS attention_handoffs,
          count(*) FILTER (WHERE client_outcome='ESTIMATE_SENT') AS estimates,
          count(*) FILTER (WHERE client_outcome='WON') AS wins,
          count(*) FILTER (WHERE client_outcome='LOST') AS losses,
          COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='ESTIMATE_SENT'),0) AS estimate_mrr,
          COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='WON'),0) AS won_mrr
        FROM connect_handoffs h
        WHERE h.client_id=c.id
      ) h ON true
      ORDER BY CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'READY' THEN 1 WHEN 'ONBOARDING' THEN 2 ELSE 3 END,c.company_name
    `)
  ]);

  const overview = overviewResult.rows[0] || {};
  const payingClients = Number(overview.paying_clients || 0);
  const wonMrr = Number(overview.won_mrr || 0);
  const estimateMrr = Number(overview.estimate_mrr || 0);
  const monthlyFeeBase = payingClients * 750;
  const revenueMultiple = monthlyFeeBase > 0 ? wonMrr / monthlyFeeBase : 0;
  const revenueRoi = monthlyFeeBase > 0 ? ((wonMrr - monthlyFeeBase) / monthlyFeeBase) * 100 : 0;

  return <AppShell active="Dashboard">
    <header>
      <div>
        <p className="eyebrow">ARBORLINE CONNECT</p>
        <h1>Command Center</h1>
        <p className="muted">One operating view for client requests, qualified handoffs, estimates, wins, losses, and portfolio revenue ROI.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
        <a className="button" href="/clients">Clients</a>
        <a className="button" href="/appointments">Appointments</a>
      </div>
    </header>

    <section className="grid stats">
      <article className="card"><p>Active clients</p><h2>{overview.active_clients ?? 0}</h2><small>{payingClients} with active billing</small></article>
      <article className="card"><p>Needs attention</p><h2>{Number(overview.open_requests || 0) + Number(overview.attention_handoffs || 0)}</h2><small>{overview.open_requests ?? 0} requests · {overview.attention_handoffs ?? 0} handoffs</small></article>
      <article className="card"><p>Open estimate value</p><h2>{money(estimateMrr)}</h2><small>{overview.estimates ?? 0} estimates currently reported</small></article>
      <article className="card"><p>Won monthly value</p><h2>{money(wonMrr)}</h2><small>{overview.wins ?? 0} client-reported wins</small></article>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">ACTION QUEUE</p><h3>What needs staff attention</h3></div><span className="badge">{actionResult.rows.length} SHOWN</span></div>
        {actionResult.rows.length ? actionResult.rows.map((item) => <div className="exception" key={`${item.item_type}-${item.item_id}`}>
          <span className={`severity ${item.priority === 0 ? "review" : "docs"}`}>{item.item_type}</span>
          <div className="grow">
            <strong>{item.item_type === "REQUEST" ? `${label(item.title)} request` : item.title}</strong>
            <p>{item.client_name} · {label(item.status)}</p>
            <p>{item.detail}</p>
            <small className="muted">{item.happened_at ? new Date(item.happened_at).toLocaleString() : ""}</small>
          </div>
          <a className="button" href={item.item_type === "REQUEST" ? `/clients/${item.client_id}` : `/prospects/${item.prospect_id}`}>Open</a>
        </div>) : <div className="empty">Nothing needs staff attention right now.</div>}
      </article>

      <aside className="panel">
        <div className="panelHead"><div><p className="eyebrow">PORTFOLIO ROI</p><h3>Recurring value created</h3></div><span className="badge">REVENUE ROI</span></div>
        <div className="health">
          <div><span>Qualified opportunities</span><b>{overview.qualified ?? 0}</b></div>
          <div><span>Qualified handoffs</span><b>{overview.handoffs ?? 0}</b></div>
          <div><span>Estimates sent</span><b>{overview.estimates ?? 0}</b></div>
          <div><span>Wins</span><b>{overview.wins ?? 0}</b></div>
          <div><span>Losses</span><b>{overview.losses ?? 0}</b></div>
        </div>
        <div className="autopilot">
          <span>WON MONTHLY VALUE</span>
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

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">RECENT OUTCOMES</p><h3>Estimates, wins, losses, and no-shows</h3></div><a className="button" href="/appointments">All appointments</a></div>
      {outcomeResult.rows.length ? outcomeResult.rows.map((row) => <div className="exception" key={row.id}>
        <span className={`severity ${row.client_outcome === "WON" ? "docs" : row.client_outcome === "LOST" || row.status === "NO_SHOW" ? "high" : "review"}`}>{label(row.client_outcome || row.status)}</span>
        <div className="grow">
          <strong>{row.company_name || "Qualified handoff"}</strong>
          <p>{row.client_name} · {label(row.booking_type)}{row.contact_name ? ` · ${row.contact_name}` : ""}</p>
          {row.outcome_notes ? <p>{row.outcome_notes}</p> : null}
          <small className="muted">{row.estimated_monthly_value ? `${money(row.estimated_monthly_value)}/mo · ` : ""}{row.outcome_updated_at ? new Date(row.outcome_updated_at).toLocaleString() : ""}</small>
        </div>
        <a className="button" href={`/prospects/${row.prospect_id}`}>Prospect</a>
      </div>) : <div className="empty">Customer-reported outcomes will appear here as clients update their handoffs.</div>}
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">CLIENT PORTFOLIO</p><h3>Every Connect customer in one view</h3></div><span className="badge">{portfolioResult.rows.length} CLIENTS</span></div>
      {portfolioResult.rows.length ? <div className="tableWrap"><table>
        <thead><tr><th>Client</th><th>Status</th><th>Qualified</th><th>Attention</th><th>Estimates</th><th>Wins / Losses</th><th>Open estimate value</th><th>Won monthly value</th><th></th></tr></thead>
        <tbody>{portfolioResult.rows.map((client) => <tr key={client.id}>
          <td><strong>{client.company_name}</strong><div className="muted">Billing: {label(client.billing_status)}</div></td>
          <td><span className="status">{label(client.status)}</span></td>
          <td>{client.qualified}</td>
          <td>{Number(client.open_requests || 0) + Number(client.attention_handoffs || 0)}<div className="muted">{client.open_requests} req · {client.attention_handoffs} handoff</div></td>
          <td>{client.estimates}</td>
          <td>{client.wins} / {client.losses}</td>
          <td>{money(client.estimate_mrr)}</td>
          <td><strong>{money(client.won_mrr)}</strong></td>
          <td><a className="tableLink" href={`/clients/${client.id}`}>Open →</a></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty">No Connect clients yet.</div>}
    </section>
  </AppShell>;
}
