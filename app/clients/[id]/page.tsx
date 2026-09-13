import { notFound } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { prepareClientPortalAccess, updateClientProfile } from "../actions";
import { startFoundingClientCheckout } from "../billing-actions";
import { updateClientRequestStatus } from "../request-actions";

export const dynamic = "force-dynamic";

function joinList(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "";
}

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

function statusClass(value: unknown) {
  const normalized = String(value || "");
  if (["PAST_DUE", "NO_SHOW", "LOST", "DECLINED"].includes(normalized)) return "status exception";
  if (["SCHEDULED", "BOOKED", "CONTACTED"].includes(normalized)) return "status booked";
  return "status";
}

export default async function ClientPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ request?: string; saved?: string; portal_invite?: string }>;
}) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const query = await searchParams;
  const pool = getPool();

  const [
    clientResult,
    rulesResult,
    inviteResult,
    requestResult,
    handoffResult,
    prospectStatsResult,
    handoffStatsResult,
    prospectResult
  ] = await Promise.all([
    pool.query(`
      SELECT c.*,
             i.target_industries,i.target_geographies,i.min_employees,i.max_employees,
             i.min_locations,i.max_locations,i.facility_types,i.decision_maker_titles,
             i.buying_signals,i.exclusions,i.qualification_notes,i.minimum_score
      FROM connect_clients c
      LEFT JOIN connect_icp_profiles i ON i.client_id=c.id
      WHERE c.id=$1
      LIMIT 1
    `, [id]),
    pool.query(`
      SELECT id,category,rule_type,label,description,weight,is_active
      FROM connect_qualification_rules
      WHERE client_id=$1
      ORDER BY sort_order,label
    `, [id]),
    pool.query(`
      SELECT email,status,expires_at,claimed_at
      FROM connect_client_invites
      WHERE client_id=$1
      ORDER BY created_at DESC
      LIMIT 1
    `, [id]),
    pool.query(`
      SELECT id,category,message,status,staff_notes,requested_by_email,created_at,updated_at,resolved_at
      FROM connect_client_requests
      WHERE client_id=$1
      ORDER BY CASE status WHEN 'SUBMITTED' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END, created_at DESC
      LIMIT 20
    `, [id]),
    pool.query(`
      SELECT id,prospect_id,company_name,contact_name,booking_type,status,scheduled_for,meeting_url,
             client_outcome,outcome_notes,outcome_updated_at,held_at,closed_at,updated_at,estimated_monthly_value
      FROM connect_handoffs
      WHERE client_id=$1
      ORDER BY COALESCE(outcome_updated_at,scheduled_for,updated_at) DESC
      LIMIT 30
    `, [id]),
    pool.query(`
      SELECT
        count(*)::int AS prospects,
        count(*) FILTER (WHERE qualification_status='REVIEW')::int AS review_prospects,
        count(*) FILTER (WHERE qualification_status='QUALIFIED' AND outreach_status='NOT_READY')::int AS qualified_not_ready,
        count(*) FILTER (
          WHERE qualification_status='QUALIFIED'
            AND outreach_status IN ('READY','QUEUED','CONTACTED','REPLIED')
            AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id)
        )::int AS outreach_attention,
        count(*) FILTER (WHERE outreach_status='READY')::int AS outreach_ready,
        count(*) FILTER (WHERE outreach_status='QUEUED')::int AS outreach_queued,
        count(*) FILTER (WHERE outreach_status='CONTACTED')::int AS contacted,
        count(*) FILTER (WHERE outreach_status='REPLIED')::int AS replied,
        count(*) FILTER (WHERE outreach_status='BOOKED')::int AS booked
      FROM connect_prospects p
      WHERE p.client_id=$1
    `, [id]),
    pool.query(`
      SELECT
        count(*) FILTER (WHERE status IN ('READY_FOR_REVIEW','SCHEDULING'))::int AS handoff_attention,
        count(*) FILTER (WHERE status='SCHEDULED' AND scheduled_for>=now())::int AS upcoming,
        count(*) FILTER (WHERE status='SCHEDULED' AND scheduled_for<now())::int AS overdue,
        count(*) FILTER (WHERE status='HELD' AND client_outcome IS NULL)::int AS awaiting_outcome,
        count(*) FILTER (WHERE status='NO_SHOW')::int AS no_shows,
        count(*) FILTER (WHERE client_outcome='FOLLOW_UP_NEEDED')::int AS follow_ups,
        count(*) FILTER (WHERE client_outcome='ESTIMATE_SENT')::int AS estimates,
        count(*) FILTER (WHERE client_outcome='WON')::int AS wins,
        count(*) FILTER (WHERE client_outcome='LOST')::int AS losses,
        COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='ESTIMATE_SENT'),0)::numeric AS estimate_mrr,
        COALESCE(sum(estimated_monthly_value) FILTER (WHERE client_outcome='WON'),0)::numeric AS won_mrr
      FROM connect_handoffs
      WHERE client_id=$1
    `, [id]),
    pool.query(`
      SELECT id,company_name,contact_name,contact_title,qualification_status,qualification_score,
             outreach_status,city,state,updated_at
      FROM connect_prospects
      WHERE client_id=$1
      ORDER BY CASE
        WHEN qualification_status='REVIEW' THEN 0
        WHEN qualification_status='QUALIFIED' AND outreach_status IN ('READY','QUEUED','CONTACTED','REPLIED') THEN 1
        WHEN qualification_status='QUALIFIED' THEN 2
        ELSE 3
      END, updated_at DESC
      LIMIT 16
    `, [id])
  ]);

  const client = clientResult.rows[0];
  if (!client) notFound();

  const portalInvite = inviteResult.rows[0];
  const prospectStats = prospectStatsResult.rows[0] || {};
  const handoffStats = handoffStatsResult.rows[0] || {};
  const openRequests = requestResult.rows.filter((request) => request.status === "SUBMITTED" || request.status === "IN_REVIEW").length;
  const needsOnboarding = client.status === "ONBOARDING" || !client.onboarding_completed_at;
  const actionCount =
    Number(prospectStats.review_prospects || 0) +
    Number(prospectStats.outreach_attention || 0) +
    openRequests +
    Number(handoffStats.handoff_attention || 0) +
    Number(handoffStats.overdue || 0) +
    Number(handoffStats.awaiting_outcome || 0) +
    Number(handoffStats.follow_ups || 0) +
    Number(handoffStats.no_shows || 0);
  const wonMrr = Number(handoffStats.won_mrr || 0);
  const estimateMrr = Number(handoffStats.estimate_mrr || 0);
  const monthlyFee = client.billing_status === "ACTIVE" ? 750 : 0;
  const revenueMultiple = monthlyFee > 0 ? wonMrr / monthlyFee : null;
  const revenueRoi = monthlyFee > 0 ? ((wonMrr - monthlyFee) / monthlyFee) * 100 : null;
  const portalStatus = portalInvite?.claimed_at ? "ACTIVE" : portalInvite?.status || "NOT INVITED";
  const healthLabel = needsOnboarding
    ? "NEEDS ONBOARDING"
    : client.billing_status === "PAST_DUE"
      ? "BILLING ATTENTION"
      : actionCount > 0
        ? "NEEDS ATTENTION"
        : client.status === "ACTIVE" || client.status === "READY"
          ? "HEALTHY"
          : label(client.status);
  const stripeReady = Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
    process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID?.trim()
  );

  return (
    <AppShell active="Clients">
      <header>
        <div>
          <p className="eyebrow">ACCOUNT WORKSPACE</p>
          <h1>{client.company_name}</h1>
          <p className="muted">Run this customer account from targeting through opportunity follow-through, handoffs, outcomes, access, and billing.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a className="button" href="/clients">Client Portfolio</a>
          <a className="button" href={`/appointments?client=${client.id}`}>Handoff Pipeline</a>
          <a className="button" href="/operations">Command Center</a>
        </div>
      </header>

      {query.saved === "1" ? <div className="notice"><strong>Client profile saved.</strong> The account workspace now reflects the latest targeting and account settings.</div> : null}
      {query.portal_invite === "ready" ? <div className="notice"><strong>Portal access prepared.</strong> The client can use the secure client-access flow with the configured email.</div> : null}
      {query.request === "updated" ? <div className="notice"><strong>Request updated.</strong> The customer will see the new status and staff note in their portal.</div> : null}

      <section className="grid stats">
        <article className="card"><p>Account health</p><h2 style={{ fontSize: 22 }}>{healthLabel}</h2><small>{client.status} · billing {client.billing_status || "UNBILLED"}</small></article>
        <article className="card"><p>Needs staff action</p><h2>{actionCount}</h2><small>{Number(prospectStats.review_prospects || 0)} review · {Number(prospectStats.outreach_attention || 0)} opportunity follow-through</small></article>
        <article className="card"><p>Open estimate value</p><h2>{money(estimateMrr)}</h2><small>{Number(handoffStats.estimates || 0)} customer-reported estimates</small></article>
        <article className="card"><p>Won monthly value</p><h2>{money(wonMrr)}</h2><small>{Number(handoffStats.wins || 0)} wins · recurring revenue reported by client</small></article>
      </section>

      <section className="split">
        <article className="panel">
          <div className="panelHead">
            <div><p className="eyebrow">ACCOUNT HEALTH</p><h3>Operational status</h3></div>
            <span className={needsOnboarding || actionCount > 0 ? "status exception" : "status"}>{healthLabel}</span>
          </div>
          <div className="health">
            <div><span>Client lifecycle</span><b>{label(client.status)}</b></div>
            <div><span>Customer onboarding</span><b>{client.onboarding_completed_at ? "Complete" : "Incomplete"}</b></div>
            <div><span>Billing</span><b>{label(client.billing_status || "UNBILLED")}</b></div>
            <div><span>Portal access</span><b>{label(portalStatus)}</b></div>
            <div><span>Qualification floor</span><b>{client.minimum_score ?? 70}/100</b></div>
            <div><span>Appointment type</span><b>{label(client.booking_type)}</b></div>
          </div>
          <div className="autopilot">
            <span>PRIMARY CONTACT</span>
            <strong style={{ fontSize: 22 }}>{client.primary_contact_name || "Not set"}</strong>
            <small>{client.primary_contact_email || "No contact email"}{client.service_area ? ` · ${client.service_area}` : ""}</small>
          </div>
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">REVENUE SIGNAL</p><h3>Customer-reported return</h3></div><span className="badge">REVENUE, NOT PROFIT</span></div>
          <div className="health">
            <div><span>Open estimated monthly value</span><b>{money(estimateMrr)}</b></div>
            <div><span>Won recurring monthly value</span><b>{money(wonMrr)}</b></div>
            <div><span>Revenue multiple</span><b>{revenueMultiple === null ? "—" : `${revenueMultiple.toFixed(1)}x`}</b></div>
            <div><span>Revenue ROI vs $750 monthly fee</span><b>{revenueRoi === null ? "—" : `${Math.round(revenueRoi)}%`}</b></div>
          </div>
          <p className="hint" style={{ marginTop: 16 }}>ROI appears only when billing is ACTIVE. It compares client-reported won monthly revenue with the $750 monthly ArborLine fee and does not estimate profit or margin.</p>
        </article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">OPPORTUNITY PIPELINE</p><h3>Qualification and outreach workload</h3></div>
          <a className="tableLink" href={`/prospects?client=${client.id}`}>Open client prospects</a>
        </div>
        <section className="grid stats" style={{ marginBottom: 18 }}>
          <article className="card"><p>Qualification review</p><h2>{Number(prospectStats.review_prospects || 0)}</h2><small>Needs staff qualification decision</small></article>
          <article className="card"><p>Actionable qualified</p><h2>{Number(prospectStats.outreach_attention || 0)}</h2><small>Ready, queued, contacted, or replied without handoff</small></article>
          <article className="card"><p>Qualified, not ready</p><h2>{Number(prospectStats.qualified_not_ready || 0)}</h2><small>Qualified but missing readiness for outreach</small></article>
          <article className="card"><p>Total prospects</p><h2>{Number(prospectStats.prospects || 0)}</h2><small>{Number(prospectStats.contacted || 0)} contacted · {Number(prospectStats.replied || 0)} replied · {Number(prospectStats.booked || 0)} booked</small></article>
        </section>
        {prospectResult.rows.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Prospect</th><th>Contact</th><th>Fit</th><th>Qualification</th><th>Outreach</th><th /></tr></thead>
              <tbody>
                {prospectResult.rows.map((prospect) => (
                  <tr key={prospect.id}>
                    <td><strong>{prospect.company_name}</strong><div className="muted">{[prospect.city, prospect.state].filter(Boolean).join(", ") || "Location not set"}</div></td>
                    <td>{prospect.contact_name || "—"}<div className="muted">{prospect.contact_title || "Contact not enriched"}</div></td>
                    <td><strong>{prospect.qualification_score ?? "—"}/100</strong></td>
                    <td><span className={prospect.qualification_status === "REVIEW" ? "status exception" : "status"}>{prospect.qualification_status}</span></td>
                    <td><span className={statusClass(prospect.outreach_status)}>{prospect.outreach_status}</span></td>
                    <td><a className="tableLink" href={`/prospects/${prospect.id}`}>Open</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No prospects have been sourced for this client yet.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">HANDOFF PIPELINE</p><h3>Appointments and customer outcomes</h3></div>
          <a className="tableLink" href={`/appointments?client=${client.id}`}>Open client handoff pipeline</a>
        </div>
        <section className="grid stats" style={{ marginBottom: 18 }}>
          <article className="card"><p>Needs scheduling</p><h2>{Number(handoffStats.handoff_attention || 0)}</h2><small>Ready for review or scheduling</small></article>
          <article className="card"><p>Upcoming / overdue</p><h2>{Number(handoffStats.upcoming || 0)} / {Number(handoffStats.overdue || 0)}</h2><small>Scheduled handoffs</small></article>
          <article className="card"><p>Follow-through</p><h2>{Number(handoffStats.follow_ups || 0) + Number(handoffStats.no_shows || 0) + Number(handoffStats.awaiting_outcome || 0)}</h2><small>Follow-up, no-show, or held awaiting outcome</small></article>
          <article className="card"><p>Estimate → win</p><h2>{Number(handoffStats.estimates || 0)} → {Number(handoffStats.wins || 0)}</h2><small>{Number(handoffStats.losses || 0)} reported losses</small></article>
        </section>
        {handoffResult.rows.length ? handoffResult.rows.map((handoff) => (
          <div className="exception" key={handoff.id}>
            <span className={statusClass(handoff.client_outcome || handoff.status)}>{label(handoff.client_outcome || handoff.status)}</span>
            <div className="grow">
              <strong>{handoff.company_name || "Qualified handoff"}</strong>
              <p>{label(handoff.booking_type)}{handoff.contact_name ? ` · ${handoff.contact_name}` : ""}{handoff.scheduled_for ? ` · ${formatWhen(handoff.scheduled_for, client.timezone)}` : ""}{handoff.estimated_monthly_value ? ` · ${money(handoff.estimated_monthly_value)}/mo` : ""}</p>
              {handoff.outcome_notes ? <p><strong>Client note:</strong> {handoff.outcome_notes}</p> : null}
            </div>
            <a className="button" href={`/prospects/${handoff.prospect_id}`}>Prospect</a>
          </div>
        )) : <div className="empty">No handoffs have been created for this client yet.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">CLIENT REQUESTS</p><h3>Targeting and account-change requests</h3></div><span className={openRequests ? "status exception" : "status"}>{openRequests} OPEN</span></div>
        <p className="muted">Requests submitted from the customer portal remain review-only until staff decides what should change. Updating a request does not automatically rewrite targeting rules.</p>
        {requestResult.rows.length ? requestResult.rows.map((request) => (
          <div className="exception" key={request.id} style={{ alignItems: "flex-start" }}>
            <span className={request.status === "SUBMITTED" || request.status === "IN_REVIEW" ? "status exception" : "status"}>{label(request.status)}</span>
            <div className="grow">
              <strong>{label(request.category)}</strong>
              <p>{request.message}</p>
              <small className="muted">Submitted {formatWhen(request.created_at, client.timezone)}{request.requested_by_email ? ` · ${request.requested_by_email}` : ""}</small>
              <form action={updateClientRequestStatus} className="form" style={{ marginTop: 12 }}>
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="requestId" value={request.id} />
                <div className="formGrid">
                  <label>Status<select name="status" defaultValue={request.status}><option>SUBMITTED</option><option>IN_REVIEW</option><option>COMPLETED</option><option>DECLINED</option></select></label>
                  <label>Staff note<textarea name="staffNotes" rows={3} maxLength={2000} defaultValue={request.staff_notes || ""} placeholder="Visible to the customer. Example: Updated the western-suburb targeting and removed restaurants." /></label>
                </div>
                <button type="submit">Save request update</button>
              </form>
            </div>
          </div>
        )) : <div className="empty">No customer requests yet.</div>}
      </section>

      <form action={updateClientProfile} className="form">
        <input type="hidden" name="clientId" value={client.id} />
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">ACCOUNT PROFILE</p><h3>Customer setup</h3></div><span className="badge">EDITABLE</span></div>
          <div className="formGrid">
            <label>Company<input name="companyName" required maxLength={180} defaultValue={client.company_name} /></label>
            <label>Industry<input name="industry" maxLength={120} defaultValue={client.industry || ""} /></label>
            <label>Primary contact<input name="primaryContactName" maxLength={120} defaultValue={client.primary_contact_name || ""} /></label>
            <label>Contact email<input name="primaryContactEmail" type="email" maxLength={200} defaultValue={client.primary_contact_email || ""} /></label>
            <label>Website<input name="website" type="url" maxLength={300} defaultValue={client.website || ""} /></label>
            <label>Service area<input name="serviceArea" maxLength={180} defaultValue={client.service_area || ""} /></label>
            <label>Status<select name="status" defaultValue={client.status}><option>ONBOARDING</option><option>READY</option><option>ACTIVE</option><option>PAUSED</option><option>CLOSED</option></select></label>
            <label>Appointment type<select name="bookingType" defaultValue={client.booking_type}><option>CALL</option><option>ESTIMATE</option><option>DEMO</option><option>WALKTHROUGH</option><option>OTHER</option></select></label>
            <label>Timezone<input name="timezone" maxLength={100} defaultValue={client.timezone || "America/Chicago"} /></label>
            <label>Minimum qualification score<input name="minimumScore" type="number" min={0} max={100} defaultValue={client.minimum_score ?? 70} /></label>
          </div>
          <label>What this client sells<textarea name="serviceSummary" rows={4} maxLength={1200} defaultValue={client.service_summary || ""} /></label>
        </section>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">IDEAL CUSTOMER PROFILE</p><h3>Who Connect should find</h3></div><span className="badge">TARGETING</span></div>
          <div className="formGrid">
            <label>Target industries<textarea name="targetIndustries" rows={3} defaultValue={joinList(client.target_industries)} placeholder="Property management, medical offices, manufacturing" /></label>
            <label>Target geographies<textarea name="targetGeographies" rows={3} defaultValue={joinList(client.target_geographies)} placeholder="Chicago, Cook County, DuPage County" /></label>
            <label>Minimum employees<input name="minEmployees" type="number" min={0} defaultValue={client.min_employees ?? ""} /></label>
            <label>Maximum employees<input name="maxEmployees" type="number" min={0} defaultValue={client.max_employees ?? ""} /></label>
            <label>Minimum locations<input name="minLocations" type="number" min={0} defaultValue={client.min_locations ?? ""} /></label>
            <label>Maximum locations<input name="maxLocations" type="number" min={0} defaultValue={client.max_locations ?? ""} /></label>
            <label>Facility / account types<textarea name="facilityTypes" rows={3} defaultValue={joinList(client.facility_types)} placeholder="Office, medical, warehouse, multi-tenant" /></label>
            <label>Decision-maker titles<textarea name="decisionMakerTitles" rows={3} defaultValue={joinList(client.decision_maker_titles)} placeholder="Facility Manager, Property Manager, Operations Director" /></label>
            <label>Buying signals<textarea name="buyingSignals" rows={3} defaultValue={joinList(client.buying_signals)} placeholder="New location, vendor review, service complaint, contract renewal" /></label>
            <label>Exclusions<textarea name="exclusions" rows={3} defaultValue={joinList(client.exclusions)} placeholder="Residential only, outside service radius, competitors" /></label>
          </div>
          <label>Qualification notes<textarea name="qualificationNotes" rows={5} maxLength={3000} defaultValue={client.qualification_notes || ""} placeholder="Any nuance the qualification engine should preserve before counting an opportunity." /></label>
        </section>

        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">QUALIFICATION ENGINE</p><h3>Current rule framework</h3></div><span className="badge">CLIENT-SPECIFIC</span></div>
          {rulesResult.rows.map((rule) => (
            <div className="exception" key={rule.id}>
              <span className={rule.rule_type === "REQUIRED" ? "status exception" : "status"}>{rule.rule_type}</span>
              <div className="grow"><strong>{rule.label}</strong><p>{rule.description || rule.category}</p></div>
              <strong>{rule.weight > 0 ? `+${rule.weight}` : rule.weight}</strong>
            </div>
          ))}
          {!rulesResult.rows.length && <div className="empty">No qualification rules configured.</div>}
        </section>

        <button type="submit">Save client profile + targeting</button>
      </form>

      <section className="split" style={{ marginTop: 12 }}>
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">CLIENT PORTAL</p><h3>Customer account access</h3></div><span className="badge">{portalStatus}</span></div>
          <p className="muted">Portal users only see their own opportunities, conversations, appointments, targeting, billing, and ROI. Internal worker queues and staff controls remain hidden.</p>
          {portalInvite ? <p style={{ marginTop: 14 }}><strong>Latest access:</strong> {portalInvite.email} · {portalStatus}{portalInvite.expires_at && !portalInvite.claimed_at ? ` · expires ${new Date(portalInvite.expires_at).toLocaleDateString()}` : ""}</p> : null}
          {client.primary_contact_email ? (
            <form action={prepareClientPortalAccess} style={{ marginTop: 14 }}>
              <input type="hidden" name="clientId" value={client.id} />
              <input type="hidden" name="email" value={client.primary_contact_email} />
              <button type="submit">Prepare secure portal access</button>
            </form>
          ) : <div className="empty">Add a primary contact email before preparing client portal access.</div>}
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">BILLING</p><h3>Founding Client subscription</h3></div><span className="badge">{client.billing_status || "UNBILLED"}</span></div>
          <p className="muted">$750/month, $0 setup, month-to-month. Checkout supports card or U.S. bank account payment.</p>
          {client.billing_current_period_end ? <p style={{ marginTop: 14 }}><strong>Current period ends:</strong> {new Date(client.billing_current_period_end).toLocaleDateString()}</p> : null}
          {stripeReady ? (
            <form action={startFoundingClientCheckout} style={{ marginTop: 14 }}>
              <input type="hidden" name="clientId" value={client.id} />
              <button type="submit">Open Founding Client checkout</button>
            </form>
          ) : <div className="empty">Stripe checkout is locked until the server-side Stripe key and Founding Client monthly price ID are configured.</div>}
        </article>
      </section>
    </AppShell>
  );
}