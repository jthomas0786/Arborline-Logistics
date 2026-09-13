import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { declineConnectHandoff, markConnectHandoffHeld, markConnectHandoffNoShow, scheduleConnectHandoff } from "./actions";

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

function formatWhen(value: unknown, timezone: string | null | undefined) {
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

function eventTime(row: Record<string, unknown>) {
  const value = row.outcome_updated_at || row.closed_at || row.held_at || row.scheduled_for || row.updated_at || row.created_at;
  const time = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function rowActions(row: Record<string, unknown>) {
  return <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
    <a className="button" href={`/prospects/${row.prospect_id}`}>Prospect</a>
    <a className="button" href={`/clients/${row.client_id}`}>Client</a>
  </div>;
}

export default async function AppointmentsPage() {
  await requirePageRole(["STAFF"]);
  const { rows: handoffs } = await getPool().query(`
    SELECT h.*,c.company_name AS client_company,c.timezone,
           p.qualification_score,p.qualification_status,p.outreach_status,
           r.body_text AS reply_text
    FROM connect_handoffs h
    JOIN connect_clients c ON c.id=h.client_id
    JOIN connect_prospects p ON p.id=h.prospect_id
    LEFT JOIN connect_replies r ON r.id=h.reply_id
    ORDER BY COALESCE(h.outcome_updated_at,h.scheduled_for,h.updated_at,h.created_at) DESC
    LIMIT 200
  `);

  const now = Date.now();
  const ready = handoffs
    .filter((row) => row.status === "READY_FOR_REVIEW" || row.status === "SCHEDULING")
    .sort((a,b) => eventTime(a) - eventTime(b));
  const scheduled = handoffs
    .filter((row) => row.status === "SCHEDULED")
    .sort((a,b) => eventTime(a) - eventTime(b));
  const overdue = scheduled.filter((row) => row.scheduled_for && new Date(String(row.scheduled_for)).getTime() < now);
  const upcoming = scheduled.filter((row) => !row.scheduled_for || new Date(String(row.scheduled_for)).getTime() >= now);
  const awaitingOutcome = handoffs
    .filter((row) => row.status === "HELD" && !row.client_outcome)
    .sort((a,b) => eventTime(b) - eventTime(a));
  const followThrough = handoffs
    .filter((row) => row.status === "NO_SHOW" || row.client_outcome === "FOLLOW_UP_NEEDED")
    .sort((a,b) => eventTime(b) - eventTime(a));
  const estimates = handoffs.filter((row) => row.client_outcome === "ESTIMATE_SENT");
  const wins = handoffs.filter((row) => row.client_outcome === "WON");
  const losses = handoffs.filter((row) => row.client_outcome === "LOST");
  const openEstimateMrr = estimates.reduce((sum,row) => sum + Number(row.estimated_monthly_value || 0),0);
  const wonMrr = wins.reduce((sum,row) => sum + Number(row.estimated_monthly_value || 0),0);
  const recentOutcomes = handoffs
    .filter((row) => row.client_outcome || ["HELD","NO_SHOW","CLOSED","DECLINED"].includes(String(row.status)))
    .sort((a,b) => eventTime(b) - eventTime(a))
    .slice(0,20);

  return <AppShell active="Appointments">
    <header>
      <div>
        <p className="eyebrow">QUALIFIED HANDOFF PIPELINE</p>
        <h1>Appointments</h1>
        <p className="muted">Move qualified opportunities from staff review to scheduled handoff, confirm what was held, and keep follow-up, estimates, and outcomes visible.</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
        <a className="button" href="/operations">Command Center</a>
        <a className="button" href="/clients">Clients</a>
      </div>
    </header>

    <section className="grid stats">
      <article className="card"><p>Ready to schedule</p><h2>{ready.length}</h2><small>Qualified handoffs awaiting staff review</small></article>
      <article className="card"><p>Upcoming</p><h2>{upcoming.length}</h2><small>{overdue.length} overdue scheduled handoff{overdue.length === 1 ? "" : "s"}</small></article>
      <article className="card"><p>Follow-up / no-show</p><h2>{followThrough.length}</h2><small>Customer follow-through still in motion</small></article>
      <article className="card"><p>Awaiting outcome</p><h2>{awaitingOutcome.length}</h2><small>Held conversations awaiting client reporting</small></article>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead">
          <div><p className="eyebrow">STAFF ACTION</p><h3>Ready for review</h3></div>
          <span className="badge">{ready.length} READY</span>
        </div>
        {ready.length ? ready.map((handoff) => <div className="exception" key={handoff.id} style={{alignItems:"flex-start"}}>
          <span className="severity review">{label(handoff.booking_type || "CALL")}</span>
          <div className="grow">
            <strong>{handoff.company_name || "Qualified handoff"}</strong>
            <p>{handoff.contact_name || handoff.contact_email || "Prospect"} · {handoff.client_company}</p>
            <p>{handoff.summary || "Interested reply received."}</p>
            {handoff.suggested_next_step ? <p><strong>Next step:</strong> {handoff.suggested_next_step}</p> : null}
            {handoff.reply_text ? <p><strong>Reply:</strong> {String(handoff.reply_text).slice(0,320)}{String(handoff.reply_text).length > 320 ? "…" : ""}</p> : null}
            <small className="muted">Qualification: {handoff.qualification_score ?? "—"}/100 · {label(handoff.qualification_status)}</small>
            <form action={scheduleConnectHandoff} className="form" style={{display:"grid",gap:8,marginTop:12}}>
              <input type="hidden" name="handoffId" value={handoff.id} />
              <label>Appointment date/time<input type="datetime-local" name="scheduledFor" required /></label>
              <label>Meeting link<input type="url" name="meetingUrl" placeholder="https://..." /></label>
              <label>Staff notes<input type="text" name="notes" maxLength={1500} placeholder="What was agreed?" /></label>
              <button type="submit">Mark scheduled</button>
            </form>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
              <form action={declineConnectHandoff}>
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="outcomeNotes" value="Handoff reviewed and declined." />
                <button type="submit" style={{background:"#26302c",color:"#f3f5f4"}}>Decline handoff</button>
              </form>
              <a className="button" href={`/prospects/${handoff.prospect_id}`}>Open prospect</a>
              <a className="button" href={`/clients/${handoff.client_id}`}>Open client</a>
            </div>
          </div>
        </div>) : <div className="empty">No qualified handoffs need scheduling review right now.</div>}
      </article>

      <aside className="panel">
        <div className="panelHead">
          <div><p className="eyebrow">SCHEDULED</p><h3>Upcoming handoffs</h3></div>
          <span className="badge">{scheduled.length} BOOKED</span>
        </div>
        {scheduled.length ? scheduled.slice(0,12).map((handoff) => {
          const isOverdue = Boolean(handoff.scheduled_for && new Date(String(handoff.scheduled_for)).getTime() < now);
          return <div className="exception" key={handoff.id} style={{alignItems:"flex-start"}}>
            <span className={`severity ${isOverdue ? "high" : "docs"}`}>{isOverdue ? "OVERDUE" : "BOOKED"}</span>
            <div className="grow">
              <strong>{handoff.company_name || "Qualified handoff"}</strong>
              <p>{formatWhen(handoff.scheduled_for,handoff.timezone)} · {handoff.client_company}</p>
              <p>{handoff.contact_name || handoff.contact_email || "Prospect"} · {label(handoff.booking_type)}</p>
              {handoff.notes ? <p>{handoff.notes}</p> : null}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:9}}>
                {handoff.meeting_url ? <a className="button" href={handoff.meeting_url} target="_blank" rel="noreferrer">Meeting link</a> : null}
                <a className="button" href={`/prospects/${handoff.prospect_id}`}>Prospect</a>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                <form action={markConnectHandoffHeld}>
                  <input type="hidden" name="handoffId" value={handoff.id} />
                  <button type="submit">Mark held</button>
                </form>
                <form action={markConnectHandoffNoShow}>
                  <input type="hidden" name="handoffId" value={handoff.id} />
                  <input type="hidden" name="outcomeNotes" value="Scheduled appointment was not held." />
                  <button type="submit" style={{background:"#26302c",color:"#f3f5f4"}}>No-show</button>
                </form>
              </div>
            </div>
          </div>;
        }) : <div className="empty">No appointments are currently scheduled.</div>}
      </aside>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">FOLLOW-THROUGH</p><h3>No-shows and follow-up needed</h3></div><span className="badge">{followThrough.length} OPEN</span></div>
        {followThrough.length ? followThrough.slice(0,12).map((row) => <div className="exception" key={row.id}>
          <span className={`severity ${row.status === "NO_SHOW" ? "high" : "review"}`}>{row.status === "NO_SHOW" ? "NO SHOW" : "FOLLOW UP"}</span>
          <div className="grow">
            <strong>{row.company_name || "Qualified handoff"}</strong>
            <p>{row.client_company} · {row.contact_name || row.contact_email || "Prospect"}</p>
            {row.outcome_notes ? <p>{row.outcome_notes}</p> : <p>{row.status === "NO_SHOW" ? "Booked appointment was not held." : "Client reported that another follow-up is needed."}</p>}
            <small className="muted">{formatWhen(row.outcome_updated_at || row.updated_at,row.timezone)}</small>
          </div>
          {rowActions(row)}
        </div>) : <div className="empty">No no-shows or follow-up-needed outcomes are waiting.</div>}
      </article>

      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">CLIENT OUTCOME</p><h3>Held, awaiting update</h3></div><span className="badge">{awaitingOutcome.length} WAITING</span></div>
        {awaitingOutcome.length ? awaitingOutcome.slice(0,12).map((row) => <div className="exception" key={row.id}>
          <span className="severity docs">HELD</span>
          <div className="grow">
            <strong>{row.company_name || "Qualified handoff"}</strong>
            <p>{row.client_company} · {row.contact_name || row.contact_email || "Prospect"}</p>
            <p>The conversation was held, but the client has not yet reported follow-up, estimate, won, or lost.</p>
            <small className="muted">Held {formatWhen(row.held_at,row.timezone)}</small>
          </div>
          {rowActions(row)}
        </div>) : <div className="empty">No held conversations are waiting on a client-reported outcome.</div>}
      </article>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">OUTCOME PIPELINE</p><h3>Estimates, wins, and losses</h3></div><span className="badge">CLIENT REPORTED</span></div>
        <div className="health">
          <div><span>Estimates sent</span><b>{estimates.length}</b></div>
          <div><span>Open estimated monthly value</span><b>{money(openEstimateMrr)}</b></div>
          <div><span>Wins</span><b>{wins.length}</b></div>
          <div><span>Won recurring monthly value</span><b>{money(wonMrr)}</b></div>
          <div><span>Losses</span><b>{losses.length}</b></div>
        </div>
        <div className="autopilot">
          <span>REVENUE REPORTING</span>
          <strong>{money(wonMrr)}/mo</strong>
          <small>Values shown here are customer-reported recurring monthly revenue values. They feed ArborLine&apos;s revenue ROI reporting and are not profit figures.</small>
        </div>
      </article>

      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">PIPELINE HEALTH</p><h3>Handoff flow at a glance</h3></div><span className="badge">{handoffs.length} TOTAL</span></div>
        <div className="health">
          <div><span>Ready for review</span><b>{ready.length}</b></div>
          <div><span>Scheduled</span><b>{scheduled.length}</b></div>
          <div><span>Overdue scheduled</span><b>{overdue.length}</b></div>
          <div><span>Held awaiting outcome</span><b>{awaitingOutcome.length}</b></div>
          <div><span>Follow-up / no-show</span><b>{followThrough.length}</b></div>
          <div><span>Estimate → win conversion</span><b>{estimates.length ? `${Math.round((wins.length / (estimates.length + wins.length)) * 100)}%` : "—"}</b></div>
        </div>
      </article>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">RECENT OUTCOMES</p><h3>Latest handoff results across clients</h3></div><span className="badge">{recentOutcomes.length} SHOWN</span></div>
      {recentOutcomes.length ? recentOutcomes.map((row) => <div className="exception" key={row.id}>
        <span className={`severity ${row.client_outcome === "WON" ? "docs" : row.client_outcome === "LOST" || row.status === "NO_SHOW" ? "high" : "review"}`}>{label(row.client_outcome || row.status)}</span>
        <div className="grow">
          <strong>{row.company_name || "Qualified handoff"}</strong>
          <p>{row.client_company} · {label(row.booking_type)} · {row.contact_name || row.contact_email || "Prospect"}</p>
          {row.outcome_notes ? <p>{row.outcome_notes}</p> : null}
          <small className="muted">{row.estimated_monthly_value ? `${money(row.estimated_monthly_value)}/mo · ` : ""}{formatWhen(row.outcome_updated_at || row.closed_at || row.held_at || row.updated_at,row.timezone)}</small>
        </div>
        {rowActions(row)}
      </div>) : <div className="empty">Client-reported handoff outcomes will appear here.</div>}
    </section>
  </AppShell>;
}
