import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { addProspect, createOutreachDraft, rescoreProspect, sendOutreachTest, suppressProspect } from "./actions";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function validClientId(value: unknown) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function prospectLane(row: Record<string, unknown>) {
  const qualification = String(row.qualification_status || "");
  const outreach = String(row.outreach_status || "");
  const hasHandoff = Boolean(row.has_handoff);

  if (qualification === "REVIEW") return "QUALIFICATION REVIEW";
  if (qualification === "QUALIFIED" && outreach === "NOT_READY") return "QUALIFIED / NOT READY";
  if (
    qualification === "QUALIFIED" &&
    !hasHandoff &&
    ["READY", "QUEUED", "CONTACTED", "REPLIED"].includes(outreach)
  ) return "ACTIONABLE QUALIFIED";
  if (qualification === "QUALIFIED" && (hasHandoff || outreach === "BOOKED")) return "HANDOFF / BOOKED";
  if (qualification === "QUALIFIED" && outreach === "STOPPED") return "STOPPED";
  if (qualification === "SUPPRESSED") return "SUPPRESSED";
  if (qualification === "REJECTED") return "REJECTED";
  return label(qualification || "PENDING");
}

function laneClass(lane: string) {
  if (lane === "QUALIFICATION REVIEW") return "status exception";
  if (lane === "ACTIONABLE QUALIFIED") return "status booked";
  return "status";
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requirePageRole(["STAFF"]);
  const query = await searchParams;
  const scopedClientId = validClientId(query.client);
  const pool = getPool();
  const [prospectsResult, clientsResult, draftsResult, statsResult] = await Promise.all([
    pool.query(`
      SELECT p.id,p.client_id,p.company_name,p.website,p.domain,p.industry,p.city,p.state,p.employee_count,p.location_count,
             p.facility_type,p.contact_name,p.contact_title,p.contact_email,p.source,p.buying_signals,
             p.enrichment_status,p.qualification_status,p.qualification_score,p.qualification_reasons,
             p.outreach_status,p.suppression_status,p.updated_at,
             c.company_name AS client_company,i.minimum_score,
             EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id) AS has_handoff
      FROM connect_prospects p
      JOIN connect_clients c ON c.id=p.client_id
      LEFT JOIN connect_icp_profiles i ON i.client_id=p.client_id
      WHERE ($1::uuid IS NULL OR p.client_id=$1::uuid)
      ORDER BY CASE
        WHEN p.qualification_status='REVIEW' THEN 0
        WHEN p.qualification_status='QUALIFIED'
          AND p.outreach_status IN ('READY','QUEUED','CONTACTED','REPLIED')
          AND NOT EXISTS (SELECT 1 FROM connect_handoffs hx WHERE hx.prospect_id=p.id) THEN 1
        WHEN p.qualification_status='QUALIFIED' AND p.outreach_status='NOT_READY' THEN 2
        WHEN p.qualification_status='QUALIFIED' AND (p.outreach_status='BOOKED' OR EXISTS (SELECT 1 FROM connect_handoffs hy WHERE hy.prospect_id=p.id)) THEN 3
        ELSE 4
      END,
      p.updated_at DESC
      LIMIT 200
    `, [scopedClientId]),
    pool.query(`
      SELECT c.id,c.company_name,c.status,i.minimum_score
      FROM connect_clients c
      JOIN connect_icp_profiles i ON i.client_id=c.id
      WHERE c.status IN ('READY','ACTIVE','ONBOARDING')
      ORDER BY c.company_name
    `),
    pool.query(`
      SELECT m.id,m.prospect_id,m.subject,m.recipient_email,m.created_at,p.company_name,c.company_name AS client_company
      FROM connect_outreach_messages m
      JOIN connect_prospects p ON p.id=m.prospect_id
      JOIN connect_clients c ON c.id=m.client_id
      WHERE m.status='DRAFT'
        AND ($1::uuid IS NULL OR m.client_id=$1::uuid)
      ORDER BY m.created_at DESC
      LIMIT 25
    `, [scopedClientId]),
    pool.query(`
      SELECT
        count(*)::int AS prospects,
        count(*) FILTER (WHERE p.qualification_status='REVIEW')::int AS qualification_review,
        count(*) FILTER (WHERE p.qualification_status='QUALIFIED' AND p.outreach_status='NOT_READY')::int AS qualified_not_ready,
        count(*) FILTER (
          WHERE p.qualification_status='QUALIFIED'
            AND p.outreach_status IN ('READY','QUEUED','CONTACTED','REPLIED')
            AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id)
        )::int AS actionable_qualified,
        count(*) FILTER (
          WHERE p.qualification_status='QUALIFIED'
            AND (p.outreach_status='BOOKED' OR EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.prospect_id=p.id))
        )::int AS handoff_booked,
        count(*) FILTER (WHERE p.qualification_status='SUPPRESSED')::int AS suppressed
      FROM connect_prospects p
      WHERE ($1::uuid IS NULL OR p.client_id=$1::uuid)
    `, [scopedClientId])
  ]);

  const prospects = prospectsResult.rows;
  const stats = statsResult.rows[0] || {};
  const selectedClient = scopedClientId ? clientsResult.rows.find((client) => client.id === scopedClientId) : null;
  const scopeLabel = selectedClient?.company_name || (scopedClientId ? "Selected client" : "All clients");

  return (
    <AppShell active="Prospects">
      <header>
        <div>
          <p className="eyebrow">OPPORTUNITY ENGINE</p>
          <h1>Prospects</h1>
          <p className="muted">Work prospects by operational lane so qualification review, not-ready records, and actual outreach follow-through never get mixed together.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <a className="button" href="/operations">Command Center</a>
          <a className="button" href="/clients">Clients</a>
        </div>
      </header>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">CLIENT SCOPE</p><h3>{scopeLabel}</h3></div>
          {scopedClientId ? <a className="tableLink" href="/prospects">Clear filter</a> : <span className="badge">ALL CLIENTS</span>}
        </div>
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ minWidth: 260, flex: "1 1 320px" }}>Client
            <select name="client" defaultValue={scopedClientId || ""}>
              <option value="">All clients</option>
              {clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
            </select>
          </label>
          <button type="submit">Apply client filter</button>
        </form>
      </section>

      <section className="grid stats">
        <article className="card"><p>Total prospects</p><h2>{stats.prospects ?? 0}</h2><small>{scopedClientId ? `For ${scopeLabel}` : "Across all configured clients"}</small></article>
        <article className="card"><p>Qualification Review</p><h2>{stats.qualification_review ?? 0}</h2><small>Needs fit/enrichment review before outreach</small></article>
        <article className="card"><p>Qualified / Not Ready</p><h2>{stats.qualified_not_ready ?? 0}</h2><small>Qualified, but not currently an outreach task</small></article>
        <article className="card"><p>Actionable Qualified</p><h2>{stats.actionable_qualified ?? 0}</h2><small>Ready, queued, contacted, or replied with no handoff yet</small></article>
        <article className="card"><p>Handoff / Booked</p><h2>{stats.handoff_booked ?? 0}</h2><small>Already advanced beyond prospect follow-through</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">OPPORTUNITY LANES</p><h3>Scored prospect pipeline</h3></div>
          <span className="status">{stats.suppressed ?? 0} suppressed</span>
        </div>
        <p className="muted">The Actionable Qualified lane is the staff follow-through queue. Qualified / Not Ready stays visible for context but does not inflate attention counts.</p>
        {prospects.length ? (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Prospect</th><th>Client</th><th>Contact</th><th>Fit score</th><th>Pipeline lane</th><th>Outreach</th><th>Actions</th></tr></thead>
              <tbody>
                {prospects.map((row) => {
                  const reasons = Array.isArray(row.qualification_reasons) ? row.qualification_reasons : [];
                  const matched = reasons.filter((reason: { matched?: boolean }) => reason.matched).length;
                  const lane = prospectLane(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.company_name}</strong>
                        <div className="muted">{row.industry || "Industry unknown"}{row.city || row.state ? ` · ${[row.city,row.state].filter(Boolean).join(", ")}` : ""}</div>
                        <div className="muted">{row.source || "Unknown source"}{row.domain ? ` · ${row.domain}` : ""}</div>
                      </td>
                      <td><a className="tableLink" href={`/clients/${row.client_id}`}>{row.client_company}</a></td>
                      <td>
                        {row.contact_name || "—"}
                        <div className="muted">{row.contact_title || "Title unknown"}</div>
                        <div className="muted">{row.contact_email || "Email missing"}</div>
                      </td>
                      <td><strong>{row.qualification_score ?? 0}/100</strong><div className="muted">{matched}/{reasons.length || 0} checks matched · floor {row.minimum_score ?? 70}</div></td>
                      <td><span className={laneClass(lane)}>{lane}</span><div className="muted">Qualification: {label(row.qualification_status)}</div></td>
                      <td><span className="status">{label(row.outreach_status)}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <a className="button" href={`/prospects/${row.id}`}>Open</a>
                          <form action={rescoreProspect}><input type="hidden" name="prospectId" value={row.id} /><button type="submit" className="secondary">Rescore</button></form>
                          {row.qualification_status === "QUALIFIED" && row.outreach_status === "READY" && !row.has_handoff ? (
                            <form action={createOutreachDraft}><input type="hidden" name="prospectId" value={row.id} /><button type="submit">Draft email</button></form>
                          ) : null}
                          {row.qualification_status !== "SUPPRESSED" ? (
                            <form action={suppressProspect}><input type="hidden" name="prospectId" value={row.id} /><button type="submit" className="secondary">Suppress</button></form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No prospects found for this client scope.</div>}
      </section>

      <section className="split">
        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">MANUAL SOURCE</p><h3>Add a prospect</h3></div></div>
          <form action={addProspect} className="form">
            <div className="formGrid">
              <label>Client<select name="clientId" required defaultValue={scopedClientId || ""}><option value="" disabled>Select client</option>{clientsResult.rows.map((client) => <option key={client.id} value={client.id}>{client.company_name} · floor {client.minimum_score}</option>)}</select></label>
              <label>Company<input name="companyName" required maxLength={180} /></label>
              <label>Website<input name="website" maxLength={300} placeholder="https://example.com" /></label>
              <label>Industry<input name="industry" maxLength={120} placeholder="Medical office" /></label>
              <label>City<input name="city" maxLength={120} /></label>
              <label>State<input name="state" maxLength={80} /></label>
              <label>Employees<input name="employeeCount" type="number" min="0" /></label>
              <label>Locations<input name="locationCount" type="number" min="0" /></label>
              <label>Facility type<input name="facilityType" maxLength={120} placeholder="Medical office" /></label>
              <label>Contact name<input name="contactName" maxLength={120} /></label>
              <label>Contact title<input name="contactTitle" maxLength={160} placeholder="Office Manager" /></label>
              <label>Contact email<input name="contactEmail" type="email" maxLength={200} /></label>
              <label>Source<input name="source" maxLength={120} defaultValue="MANUAL" /></label>
              <label>Source URL<input name="sourceUrl" maxLength={500} placeholder="https://" /></label>
            </div>
            <label>Buying signals<textarea name="buyingSignals" rows={3} maxLength={2000} placeholder="New location, vendor review, hiring facilities staff" /></label>
            <button type="submit" style={{ marginTop: 14 }}>Add + score prospect</button>
          </form>
        </article>

        <article className="panel">
          <div className="panelHead"><div><p className="eyebrow">CONTROLLED RESEND TEST</p><h3>Outreach drafts</h3></div></div>
          <p className="muted">Drafts use Josh Thomas / ArborLine Connect. Test sends go only to the test address entered here — never to the prospect.</p>
          {draftsResult.rows.length ? draftsResult.rows.map((draft) => (
            <div className="exception" key={draft.id}>
              <div className="grow">
                <strong>{draft.company_name}</strong>
                <p>{draft.client_company} · {draft.subject}</p>
                <p>Intended recipient: {draft.recipient_email}</p>
              </div>
              <form action={sendOutreachTest} className="form" style={{ minWidth: 240 }}>
                <input type="hidden" name="messageId" value={draft.id} />
                <label>Test recipient<input name="testRecipient" type="email" required placeholder="you@yourdomain.com" /></label>
                <button type="submit">Send test</button>
              </form>
            </div>
          )) : <div className="empty">No outreach drafts for this client scope.</div>}
        </article>
      </section>
    </AppShell>
  );
}
