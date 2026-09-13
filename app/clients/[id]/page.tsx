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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ request?: string }> }) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const query = await searchParams;
  const pool = getPool();
  const [clientResult, rulesResult, inviteResult, requestResult, handoffResult] = await Promise.all([
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
    `,[id]),
    pool.query(`
      SELECT id,category,message,status,staff_notes,requested_by_email,created_at,updated_at,resolved_at
      FROM connect_client_requests
      WHERE client_id=$1
      ORDER BY CASE status WHEN 'SUBMITTED' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END, created_at DESC
      LIMIT 20
    `,[id]),
    pool.query(`
      SELECT id,prospect_id,company_name,contact_name,booking_type,status,scheduled_for,
             client_outcome,outcome_notes,outcome_updated_at,held_at,closed_at,updated_at,estimated_monthly_value
      FROM connect_handoffs
      WHERE client_id=$1
      ORDER BY COALESCE(outcome_updated_at,scheduled_for,updated_at) DESC
      LIMIT 20
    `,[id])
  ]);

  const client = clientResult.rows[0];
  const portalInvite = inviteResult.rows[0];
  if (!client) notFound();

  const openRequests = requestResult.rows.filter((request) => request.status === "SUBMITTED" || request.status === "IN_REVIEW").length;
  const stripeReady = Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() &&
    process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID?.trim()
  );

  return (
    <AppShell active="Clients">
      <header>
        <div>
          <p className="eyebrow">CLIENT ONBOARDING</p>
          <h1>{client.company_name}</h1>
          <p className="muted">Define the target account, decision maker, buying signals, exclusions, and handoff standard before sourcing begins.</p>
        </div>
        <a className="button" href="/clients">Back to clients</a>
      </header>

      <section className="grid stats">
        <article className="card"><p>Status</p><h2>{client.status}</h2><small>Controls campaign readiness</small></article>
        <article className="card"><p>Billing</p><h2>{client.billing_status || "UNBILLED"}</h2><small>Stripe subscription state</small></article>
        <article className="card"><p>Qualification floor</p><h2>{client.minimum_score ?? 70}</h2><small>Minimum fit score out of 100</small></article>
        <article className="card"><p>Open client requests</p><h2>{openRequests}</h2><small>Targeting or account changes needing review</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">STRIPE BILLING</p><h3>Founding Client billing</h3></div>
          <span className="badge">{client.billing_status || "UNBILLED"}</span>
        </div>
        <p className="muted"><strong>Launch offer:</strong> $750/month, $0 setup, month-to-month for the first 3–5 Founding Clients. Checkout collects the client billing address and supports card or U.S. bank account payment.</p>
        {client.stripe_customer_id && <p><strong>Stripe customer:</strong> {client.stripe_customer_id}</p>}
        {client.stripe_subscription_id && <p><strong>Subscription:</strong> {client.stripe_subscription_id}</p>}
        {client.billing_current_period_end && <p><strong>Current period ends:</strong> {new Date(client.billing_current_period_end).toLocaleDateString()}</p>}
        {stripeReady ? (
          <form action={startFoundingClientCheckout}>
            <input type="hidden" name="clientId" value={client.id} />
            <button type="submit">Open Founding Client checkout</button>
          </form>
        ) : <div className="empty">Stripe checkout is locked until the server-side Stripe key and Founding Client monthly price ID are configured.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">CLIENT PORTAL</p><h3>Customer account access</h3></div><span className="badge">{portalInvite?.status || "NOT INVITED"}</span></div>
        <p className="muted">Portal users only see their own opportunities, conversations, appointments, targeting, and billing. They never see ArborLine worker queues, sourcing providers, suppression internals, or admin controls.</p>
        {portalInvite ? <p><strong>Latest invite:</strong> {portalInvite.email} · {portalInvite.status}{portalInvite.expires_at ? ` · expires ${new Date(portalInvite.expires_at).toLocaleDateString()}` : ""}</p> : null}
        {client.primary_contact_email ? <form action={prepareClientPortalAccess}>
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="email" value={client.primary_contact_email} />
          <button type="submit">Prepare secure portal access</button>
          <small className="muted" style={{marginLeft:10}}>Client then signs in at /client-access using a secure emailed link.</small>
        </form> : <div className="empty">Add a primary contact email before preparing client portal access.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">CLIENT REQUESTS</p><h3>Targeting and account-change requests</h3></div><span className="badge">{openRequests} OPEN</span></div>
        <p className="muted">Requests submitted from the customer portal stay review-only until you decide what should change. Updating a request does not automatically rewrite targeting rules.</p>
        {query.request === "updated" ? <div className="notice"><strong>Request updated.</strong> The customer will see the new status and staff note in their portal.</div> : null}
        {requestResult.rows.length ? requestResult.rows.map((request) => <div className="exception" key={request.id} style={{alignItems:"flex-start"}}>
          <span className={`severity ${request.status === "SUBMITTED" || request.status === "IN_REVIEW" ? "review" : ""}`}>{label(request.status)}</span>
          <div className="grow">
            <strong>{label(request.category)}</strong>
            <p>{request.message}</p>
            <small className="muted">Submitted {new Date(request.created_at).toLocaleString()}{request.requested_by_email ? ` · ${request.requested_by_email}` : ""}</small>
            <form action={updateClientRequestStatus} className="form" style={{marginTop:12}}>
              <input type="hidden" name="clientId" value={client.id}/>
              <input type="hidden" name="requestId" value={request.id}/>
              <div className="formGrid">
                <label>Status<select name="status" defaultValue={request.status}><option>SUBMITTED</option><option>IN_REVIEW</option><option>COMPLETED</option><option>DECLINED</option></select></label>
                <label>Staff note<textarea name="staffNotes" rows={3} maxLength={2000} defaultValue={request.staff_notes || ""} placeholder="Visible to the customer. Example: Updated the western-suburb targeting and removed restaurants."/></label>
              </div>
              <button type="submit">Save request update</button>
            </form>
          </div>
        </div>) : <div className="empty">No customer requests yet.</div>}
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">HANDOFF OUTCOMES</p><h3>What happened after ArborLine handed it off</h3></div><span className="badge">{handoffResult.rows.length} RECENT</span></div>
        <p className="muted">Customer-reported outcomes flow back here so you can see whether meetings were held, estimates were sent, opportunities were won or lost, and the recurring monthly value attached to the result.</p>
        {handoffResult.rows.length ? handoffResult.rows.map((handoff) => <div className="exception" key={handoff.id}>
          <span className={`severity ${handoff.client_outcome === "WON" ? "ok" : handoff.status === "NO_SHOW" || handoff.client_outcome === "LOST" ? "block" : "review"}`}>{label(handoff.client_outcome || handoff.status)}</span>
          <div className="grow">
            <strong>{handoff.company_name || "Qualified handoff"}</strong>
            <p>{label(handoff.booking_type)}{handoff.contact_name ? ` · ${handoff.contact_name}` : ""}{handoff.scheduled_for ? ` · ${new Date(handoff.scheduled_for).toLocaleString()}` : ""}{handoff.estimated_monthly_value ? ` · ${money(handoff.estimated_monthly_value)}/mo` : ""}</p>
            {handoff.outcome_notes ? <p><strong>Client note:</strong> {handoff.outcome_notes}</p> : null}
            {handoff.outcome_updated_at ? <small className="muted">Client updated {new Date(handoff.outcome_updated_at).toLocaleString()}</small> : null}
          </div>
          <a className="button" href={`/prospects/${handoff.prospect_id}`}>Prospect</a>
        </div>) : <div className="empty">No handoffs have been created for this client yet.</div>}
      </section>

      <form action={updateClientProfile} className="form">
        <input type="hidden" name="clientId" value={client.id} />
        <section className="panel" style={{ marginBottom: 12 }}>
          <div className="panelHead"><div><p className="eyebrow">ACCOUNT</p><h3>Client setup</h3></div></div>
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
          <div className="panelHead"><div><p className="eyebrow">IDEAL CUSTOMER PROFILE</p><h3>Who Connect should find</h3></div></div>
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
          <div className="panelHead"><div><p className="eyebrow">QUALIFICATION ENGINE</p><h3>Current rule framework</h3></div><span className="badge">Client-specific</span></div>
          {rulesResult.rows.map((rule) => <div className="exception" key={rule.id}><span className={`severity ${rule.rule_type === "REQUIRED" ? "review" : ""}`}>{rule.rule_type}</span><div className="grow"><strong>{rule.label}</strong><p>{rule.description || rule.category}</p></div><strong>{rule.weight > 0 ? `+${rule.weight}` : rule.weight}</strong></div>)}
          {!rulesResult.rows.length && <div className="empty">No qualification rules configured.</div>}
        </section>

        <button type="submit">Save client profile</button>
      </form>
    </AppShell>
  );
}
