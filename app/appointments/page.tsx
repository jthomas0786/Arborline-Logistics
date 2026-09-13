import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { declineConnectHandoff, markConnectHandoffHeld, markConnectHandoffNoShow, scheduleConnectHandoff } from "./actions";

export const dynamic = "force-dynamic";

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

export default async function AppointmentsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();
  let migrationReady = true;
  let handoffs: Array<Record<string, unknown>> = [];
  try {
    const result = await pool.query(
      `SELECT h.*,c.company_name AS client_company,c.timezone,r.body_text AS reply_text
       FROM connect_handoffs h
       JOIN connect_clients c ON c.id=h.client_id
       JOIN connect_replies r ON r.id=h.reply_id
       ORDER BY CASE h.status
         WHEN 'READY_FOR_REVIEW' THEN 1
         WHEN 'SCHEDULING' THEN 2
         WHEN 'SCHEDULED' THEN 3
         WHEN 'HELD' THEN 4
         WHEN 'NO_SHOW' THEN 5
         ELSE 6 END,
         COALESCE(h.scheduled_for,h.created_at) DESC
       LIMIT 100`
    );
    handoffs = result.rows;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") migrationReady = false;
    else throw error;
  }

  const count = (status: string) => handoffs.filter((row) => row.status === status).length;
  const ready = handoffs.filter((row) => row.status === "READY_FOR_REVIEW" || row.status === "SCHEDULING");
  const scheduled = handoffs.filter((row) => row.status === "SCHEDULED");
  const completed = handoffs.filter((row) => ["HELD","NO_SHOW","DECLINED","CLOSED"].includes(String(row.status))).slice(0, 20);

  return <AppShell active="Appointments">
    <header><div><p className="eyebrow">QUALIFIED HANDOFFS</p><h1>Appointments</h1><p className="muted">Interested replies become handoffs here. Review the context, schedule the next step, and track whether the appointment was actually held.</p></div></header>

    {!migrationReady ? <div className="notice"><strong>Appointment automation is staged in the launch release.</strong> The handoff migration will be applied before this release is promoted to production.</div> : null}

    <section className="grid stats">
      <article className="card"><p>Ready</p><h2>{count("READY_FOR_REVIEW") + count("SCHEDULING")}</h2><small>Qualified replies needing a next step</small></article>
      <article className="card"><p>Scheduled</p><h2>{count("SCHEDULED")}</h2><small>Date/time agreed</small></article>
      <article className="card"><p>Held</p><h2>{count("HELD")}</h2><small>Completed qualified conversations</small></article>
      <article className="card"><p>No-show</p><h2>{count("NO_SHOW")}</h2><small>Booked but not held</small></article>
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">READY FOR REVIEW</p><h3>Interested prospects</h3></div><span className="badge">{ready.length} READY</span></div>
      {ready.length === 0 ? <p className="muted">No qualified handoffs are waiting right now.</p> : ready.map((handoff) => <div className="exception" key={String(handoff.id)}>
        <span className="severity review">{String(handoff.booking_type || "CALL")}</span>
        <div className="grow">
          <strong>{String(handoff.company_name || "Company")} · {String(handoff.contact_name || handoff.contact_email || "Contact")}</strong>
          <p>{String(handoff.summary || "Interested reply received.")}</p>
          <small>{String(handoff.client_company || "Client")}</small>
          <form action={scheduleConnectHandoff} style={{display:"grid",gap:8,marginTop:10}}>
            <input type="hidden" name="handoffId" value={String(handoff.id)} />
            <label>Appointment date/time <input type="datetime-local" name="scheduledFor" required /></label>
            <label>Meeting link <input type="url" name="meetingUrl" placeholder="https://..." /></label>
            <label>Notes <input type="text" name="notes" placeholder="What was agreed?" /></label>
            <button type="submit">Mark scheduled</button>
          </form>
          <form action={declineConnectHandoff} style={{marginTop:8}}>
            <input type="hidden" name="handoffId" value={String(handoff.id)} />
            <input type="hidden" name="outcomeNotes" value="Handoff reviewed and declined." />
            <button type="submit">Decline handoff</button>
          </form>
        </div>
      </div>)}
    </section>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead"><div><p className="eyebrow">SCHEDULED</p><h3>Upcoming qualified conversations</h3></div><span className="badge">{scheduled.length} BOOKED</span></div>
      {scheduled.length === 0 ? <p className="muted">No appointments are currently scheduled.</p> : scheduled.map((handoff) => <div className="exception" key={String(handoff.id)}>
        <span className="severity">BOOKED</span>
        <div className="grow">
          <strong>{String(handoff.company_name || "Company")} · {String(handoff.contact_name || handoff.contact_email || "Contact")}</strong>
          <p>{formatWhen(handoff.scheduled_for, String(handoff.timezone || "America/Chicago"))}</p>
          {handoff.meeting_url ? <p><a href={String(handoff.meeting_url)} target="_blank" rel="noreferrer">Open meeting link</a></p> : null}
          {handoff.notes ? <small>{String(handoff.notes)}</small> : null}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
            <form action={markConnectHandoffHeld}><input type="hidden" name="handoffId" value={String(handoff.id)} /><button type="submit">Mark held</button></form>
            <form action={markConnectHandoffNoShow}><input type="hidden" name="handoffId" value={String(handoff.id)} /><input type="hidden" name="outcomeNotes" value="Scheduled appointment was not held." /><button type="submit">No-show</button></form>
          </div>
        </div>
      </div>)}
    </section>

    <section className="split">
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">QUALITY STANDARD</p><h3>What earns a handoff</h3></div></div><div className="health"><div><span>Right geography and company profile</span><b>Required</b></div><div><span>Right decision maker or influencer</span><b>Required</b></div><div><span>Positive reply or agreed next step</span><b>Required</b></div><div><span>Human review before scheduling</span><b>Required</b></div></div></article>
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">QUALITY CONTROL</p><h3>Booked ≠ held</h3></div></div><p className="muted">Connect tracks scheduled appointments separately from conversations that were actually held. That gives clients a clean quality measure and keeps no-shows from being counted as successful meetings.</p><div className="health"><div><span>Recent outcomes tracked</span><b>{completed.length}</b></div><div><span>Held</span><b>{count("HELD")}</b></div><div><span>No-show</span><b>{count("NO_SHOW")}</b></div></div></article>
    </section>
  </AppShell>;
}
