import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { startClientOnboarding } from "./actions";

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

function formatDate(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

function clientHealth(row: Record<string, unknown>) {
  if (row.status === "CLOSED") return { label: "CLOSED", severity: "" };
  if (row.billing_status === "PAST_DUE") return { label: "BILLING ATTENTION", severity: "high" };
  if (row.status === "ONBOARDING" || !row.onboarding_completed_at) return { label: "NEEDS ONBOARDING", severity: "review" };
  if (Number(row.open_requests || 0) > 0) return { label: "REQUESTS OPEN", severity: "review" };
  if (Number(row.follow_ups || 0) + Number(row.no_shows || 0) > 0) return { label: "FOLLOW-UP", severity: "high" };
  if (Number(row.attention_handoffs || 0) > 0) return { label: "HANDOFF REVIEW", severity: "review" };
  if (Number(row.review_prospects || 0) + Number(row.actionable_qualified || 0) > 0) return { label: "OPPORTUNITY ATTENTION", severity: "docs" };
  if (row.status === "PAUSED") return { label: "PAUSED", severity: "review" };
  if (row.status === "ACTIVE" && row.billing_status === "ACTIVE") return { label: "HEALTHY", severity: "ok" };
  if (row.status === "READY") return { label: "READY", severity: "ok" };
  return { label: label(row.status || "WATCH"), severity: "review" };
}

export default async function ClientsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  const [clientsResult, pilotResult] = await Promise.all([
    pool.query(`
      SELECT c.id,c.company_name,c.industry,c.service_area,c.status,c.billing_status,c.booking_type,
             c.primary_contact_name,c.primary_contact_email,c.onboarding_completed_at,c.billing_current_period_end,
             c.updated_at,i.minimum_score,
             cardinality(i.target_industries) AS industry_count,
             cardinality(i.target_geographies) AS geography_count,
             COALESCE(req.open_requests,0)::int AS open_requests,
             COALESCE(p.review_prospects,0)::int AS review_prospects,
             COALESCE(p.qualified_not_ready,0)::int AS qualified_not_ready,
             COALESCE(p.actionable_qualified,0)::int AS actionable_qualified,
             COALESCE(h.attention_handoffs,0)::int AS attention_handoffs,
             COALESCE(h.upcoming_handoffs,0)::int AS upcoming_handoffs,
             COALESCE(h.follow_ups,0)::int AS follow_ups,
             COALESCE(h.no_shows,0)::int AS no_shows,
             COALESCE(h.estimates,0)::int AS estimates,
             COALESCE(h.wins,0)::int AS wins,
             COALESCE(h.losses,0)::int AS losses,
             COALESCE(h.estimate_mrr,0)::numeric AS estimate_mrr,
             COALESCE(h.won_mrr,0)::numeric AS won_mrr,
             inv.status AS portal_status
      FROM connect_clients c
      LEFT JOIN connect_icp_profiles i ON i.client_id=c.id
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE status IN ('SUBMITTED','IN_REVIEW')) AS open_requests
        FROM connect_client_requests r
        WHERE r.client_id=c.id
      ) req ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE qualification_status='REVIEW') AS review_prospects,
               count(*) FILTER (
                 WHERE qualification_status='QUALIFIED'
                   AND outreach_status='NOT_READY'
               ) AS qualified_not_ready,
               count(*) FILTER (
                 WHERE qualification_status='QUALIFIED'
                   AND outreach_status IN ('READY','QUEUED','CONTACTED','REPLIED')
                   AND NOT EXISTS (SELECT 1 FROM connect_handoffs h2 WHERE h2.prospect_id=p.id)
               ) AS actionable_qualified
        FROM connect_prospects p
        WHERE p.client_id=c.id
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE status IN ('READY_FOR_REVIEW','SCHEDULING')) AS attention_handoffs,
               count(*) FILTER (WHERE status='SCHEDULED' AND scheduled_for >= now()) AS upcoming_handoffs,
               count(*) FILTER (WHERE client_outcome='FOLLOW_UP_NEEDED') AS follow_ups,
               count(*) FILTER (WHERE status='NO_SHOW') AS no_shows,
               count(*) FILTER (WHERE client_outcome='ESTIMATE_SENT') AS estimates,
               count(*) FILTER (WHERE client_outcome='WON') AS wins,
               count(*) FILTER (WHERE client_outcome='LOST') AS losses,
               COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='ESTIMATE_SENT'),0) AS estimate_mrr,
               COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='WON'),0) AS won_mrr
        FROM connect_handoffs h
        WHERE h.client_id=c.id
      ) h ON true
      LEFT JOIN LATERAL (
        SELECT status
        FROM connect_client_invites ci
        WHERE ci.client_id=c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) inv ON true
      ORDER BY CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'READY' THEN 1 WHEN 'ONBOARDING' THEN 2 WHEN 'PAUSED' THEN 3 ELSE 4 END,
               c.updated_at DESC
      LIMIT 100
    `),
    pool.query(`
      SELECT p.id,p.name,p.work_email,p.company_name,p.industry,p.service_area,p.website,p.notes,p.created_at
      FROM connect_pilot_interest p
      LEFT JOIN connect_clients c ON c.pilot_interest_id=p.id
      WHERE c.id IS NULL AND p.status IN ('NEW','CONTACTED','QUALIFIED')
      ORDER BY p.created_at DESC
      LIMIT 25
    `)
  ]);

  const clients = clientsResult.rows as Array<Record<string, unknown>>;
  const attentionClients = clients.filter((row) => {
    const health = clientHealth(row).label;
    return !["HEALTHY", "READY", "CLOSED", "PAUSED"].includes(health);
  }).length;
  const onboardingCount = clients.filter((row) => row.status === "ONBOARDING" || !row.onboarding_completed_at).length;
  const payingClients = clients.filter((row) => row.billing_status === "ACTIVE").length;
  const openRequests = clients.reduce((sum, row) => sum + Number(row.open_requests || 0), 0);
  const reviewProspects = clients.reduce((sum, row) => sum + Number(row.review_prospects || 0), 0);
  const actionableQualified = clients.reduce((sum, row) => sum + Number(row.actionable_qualified || 0), 0);
  const qualifiedNotReady = clients.reduce((sum, row) => sum + Number(row.qualified_not_ready || 0), 0);
  const opportunityAttention = reviewProspects + actionableQualified;
  const upcoming = clients.reduce((sum, row) => sum + Number(row.upcoming_handoffs || 0), 0);
  const estimateMrr = clients.reduce((sum, row) => sum + Number(row.estimate_mrr || 0), 0);
  const wonMrr = clients.reduce((sum, row) => sum + Number(row.won_mrr || 0), 0);
  const feeBase = payingClients * 750;
  const revenueMultiple = feeBase > 0 ? wonMrr / feeBase : null;
  const revenueRoi = feeBase > 0 ? ((wonMrr - feeBase) / feeBase) * 100 : null;

  return (
    <AppShell active="Clients">
      <header>
        <div>
          <p className="eyebrow">CLIENT PORTFOLIO</p>
          <h1>Account Health</h1>
          <p className="muted">See which customers need onboarding, targeting review, opportunity attention, handoff follow-through, or account support—and what value Connect is producing for each account.</p>
        </div>
        <a className="button" href="/operations">Command Center</a>
      </header>

      <section className="grid stats">
        <article className="card"><p>Clients needing attention</p><h2>{attentionClients}</h2><small>Onboarding, requests, opportunities, handoffs, or billing</small></article>
        <article className="card"><p>Needs onboarding</p><h2>{onboardingCount}</h2><small>Setup not yet completed</small></article>
        <article className="card"><p>Open customer requests</p><h2>{openRequests}</h2><small>Targeting or account changes</small></article>
        <article className="card"><p>Opportunity attention</p><h2>{opportunityAttention}</h2><small>{reviewProspects} review · {actionableQualified} actionable qualified</small></article>
        <article className="card"><p>Qualified / Not Ready</p><h2>{qualifiedNotReady}</h2><small>Qualified context, not a staff action queue</small></article>
        <article className="card"><p>Upcoming handoffs</p><h2>{upcoming}</h2><small>Scheduled qualified conversations</small></article>
        <article className="card"><p>Open estimate value</p><h2>{money(estimateMrr)}</h2><small>Customer-reported recurring monthly value</small></article>
        <article className="card"><p>Won monthly value</p><h2>{money(wonMrr)}</h2><small>Customer-reported recurring revenue</small></article>
        <article className="card"><p>Portfolio revenue multiple</p><h2>{revenueMultiple === null ? "—" : `${revenueMultiple.toFixed(1)}×`}</h2><small>{revenueRoi === null ? "Starts when billing is active" : `${percent(revenueRoi)} revenue ROI vs active $750 fees`}</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">ACCOUNT HEALTH</p><h3>Client portfolio</h3></div>
          <span className="badge">{clients.length} ACCOUNTS</span>
        </div>
        {clients.length ? clients.map((row) => {
          const health = clientHealth(row);
          const clientFee = row.billing_status === "ACTIVE" ? 750 : 0;
          const clientWonMrr = Number(row.won_mrr || 0);
          const clientMultiple = clientFee > 0 ? clientWonMrr / clientFee : null;
          const clientRoi = clientFee > 0 ? ((clientWonMrr - clientFee) / clientFee) * 100 : null;
          const followUpCount = Number(row.follow_ups || 0) + Number(row.no_shows || 0);
          const profileCoverage = `${Number(row.industry_count || 0)} industries · ${Number(row.geography_count || 0)} markets`;
          return (
            <article className="exception" key={String(row.id)} style={{ alignItems: "flex-start" }}>
              <span className={`severity ${health.severity}`}>{health.label}</span>
              <div className="grow">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ fontSize: 16 }}>{String(row.company_name || "Client")}</strong>
                    <p>{String(row.industry || "Industry not set")}{row.service_area ? ` · ${String(row.service_area)}` : ""}</p>
                    <small className="muted">{row.primary_contact_name || row.primary_contact_email ? `${String(row.primary_contact_name || "Primary contact")}${row.primary_contact_email ? ` · ${String(row.primary_contact_email)}` : ""}` : "Primary contact not set"}</small>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <span className="status">{label(row.status)}</span>
                    <span className={`status ${row.billing_status === "PAST_DUE" ? "exception" : ""}`}>{label(row.billing_status || "UNBILLED")}</span>
                    <span className="status booked">PORTAL {label(row.portal_status || "NOT INVITED")}</span>
                  </div>
                </div>

                <div className="split" style={{ marginTop: 16, marginBottom: 0 }}>
                  <div className="health">
                    <div><span>ICP coverage</span><b>{profileCoverage}</b></div>
                    <div><span>Qualification floor</span><b>{Number(row.minimum_score ?? 70)}/100</b></div>
                    <div><span>Qualification review</span><b>{Number(row.review_prospects || 0)}</b></div>
                    <div><span>Actionable qualified</span><b>{Number(row.actionable_qualified || 0)}</b></div>
                    <div><span>Qualified / not ready</span><b>{Number(row.qualified_not_ready || 0)}</b></div>
                    <div><span>Open customer requests</span><b>{Number(row.open_requests || 0)}</b></div>
                    <div><span>Handoffs needing review</span><b>{Number(row.attention_handoffs || 0)}</b></div>
                    <div><span>Upcoming appointments</span><b>{Number(row.upcoming_handoffs || 0)}</b></div>
                    <div><span>Follow-up / no-show</span><b>{followUpCount}</b></div>
                  </div>
                  <div className="health">
                    <div><span>Estimates</span><b>{Number(row.estimates || 0)}</b></div>
                    <div><span>Wins / losses</span><b>{Number(row.wins || 0)} / {Number(row.losses || 0)}</b></div>
                    <div><span>Open estimate value</span><b>{money(row.estimate_mrr)}</b></div>
                    <div><span>Won monthly value</span><b>{money(row.won_mrr)}</b></div>
                    <div><span>Revenue multiple</span><b>{clientMultiple === null ? "—" : `${clientMultiple.toFixed(1)}×`}</b></div>
                    <div><span>Revenue ROI</span><b>{clientRoi === null ? "—" : percent(clientRoi)}</b></div>
                    <div><span>Onboarding completed</span><b>{row.onboarding_completed_at ? formatDate(row.onboarding_completed_at) : "Not completed"}</b></div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  <a className="button" href={`/clients/${String(row.id)}`}>Open account</a>
                  <a className="tableLink" href={`/prospects?client=${String(row.id)}`} style={{ padding: "10px 4px" }}>Prospects</a>
                  <a className="tableLink" href={`/appointments?client=${String(row.id)}`} style={{ padding: "10px 4px" }}>Handoffs</a>
                </div>
              </div>
            </article>
          );
        }) : <div className="empty">No Connect clients yet. Start onboarding from inbound interest or add an account below.</div>}
        <p className="hint" style={{ marginTop: 14 }}>Revenue multiple and revenue ROI compare customer-reported won recurring monthly value with the $750 monthly Connect fee for accounts whose billing status is ACTIVE. These are revenue metrics, not profit metrics.</p>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">NEW CUSTOMER INBOX</p><h3>Start onboarding from interest</h3></div><span className="badge">{pilotResult.rows.length} WAITING</span></div>
          {pilotResult.rows.length ? pilotResult.rows.map((pilot) => (
            <div className="exception" key={pilot.id}>
              <div className="grow">
                <strong>{pilot.company_name}</strong>
                <p>{pilot.name} · {pilot.work_email}{pilot.industry ? ` · ${pilot.industry}` : ""}</p>
                <p>{pilot.service_area || "Service area not supplied"}</p>
              </div>
              <form action={startClientOnboarding}>
                <input type="hidden" name="pilotInterestId" value={pilot.id} />
                <input type="hidden" name="companyName" value={pilot.company_name} />
                <input type="hidden" name="primaryContactName" value={pilot.name} />
                <input type="hidden" name="primaryContactEmail" value={pilot.work_email} />
                <input type="hidden" name="industry" value={pilot.industry || ""} />
                <input type="hidden" name="serviceArea" value={pilot.service_area || ""} />
                <input type="hidden" name="website" value={pilot.website || ""} />
                <input type="hidden" name="serviceSummary" value={pilot.notes || ""} />
                <button type="submit">Start onboarding</button>
              </form>
            </div>
          )) : <div className="empty">No unconverted customer interest.</div>}
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">ADD CLIENT</p><h3>Start a new account</h3></div></div>
          <p className="muted" style={{ marginBottom: 15 }}>Use this when a customer did not come through the interest form. The account starts in onboarding and can be fully configured from its account workspace.</p>
          <form action={startClientOnboarding} className="form">
            <div className="formGrid">
              <label>Company<input name="companyName" required maxLength={180} /></label>
              <label>Industry<input name="industry" maxLength={120} placeholder="Commercial cleaning" /></label>
              <label>Contact name<input name="primaryContactName" maxLength={120} /></label>
              <label>Contact email<input name="primaryContactEmail" type="email" maxLength={200} /></label>
              <label>Service area<input name="serviceArea" maxLength={180} placeholder="Chicago metro" /></label>
              <label>Website<input name="website" type="url" maxLength={300} placeholder="https://" /></label>
            </div>
            <label>What they sell<textarea name="serviceSummary" rows={4} maxLength={1200} placeholder="Recurring commercial cleaning for offices, medical facilities, and multi-site operators." /></label>
            <button type="submit" style={{ marginTop: 14 }}>Start onboarding</button>
          </form>
        </article>
      </section>
    </AppShell>
  );
}