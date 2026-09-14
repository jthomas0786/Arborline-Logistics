import Link from "next/link";
import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  classifyReplyManually,
  completeReplyFollowUp,
  createHandoffFromReply,
  fulfillWalkthroughRequest,
  markWrongContactForReenrichment,
  scheduleReplyFollowUp,
  stopProspectAfterObjection
} from "./actions";

export const dynamic = "force-dynamic";

const CLASSIFICATIONS = [
  ["INTERESTED", "Interested / wants to talk"],
  ["VIDEO_REQUESTED", "Requested walkthrough"],
  ["NOT_NOW", "Not now / revisit later"],
  ["WRONG_CONTACT", "Wrong contact"],
  ["OBJECTION", "Objection / not interested"],
  ["OUT_OF_OFFICE", "Out of office"],
  ["UNSUBSCRIBE", "Unsubscribe / do not contact"],
  ["UNKNOWN", "Needs manual review"]
] as const;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago"
  }).format(date);
}

function dateInput(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Chicago"
  }).format(date);
}

function resultCopy(result: string | null) {
  const copy: Record<string, string> = {
    classified: "Reply classification saved.",
    classification_invalid: "Choose a valid reply classification.",
    classification_blocked: "Classification was blocked because this reply is no longer safely matched to a prospect.",
    handoff_created: "Handoff created and added to the Appointments pipeline.",
    handoff_exists: "A handoff already exists for this reply.",
    handoff_blocked: "Handoff creation is available only for an Interested reply.",
    walkthrough_sent: "Requested walkthrough accepted for real prospect delivery.",
    walkthrough_exists: "The requested walkthrough was already sent; duplicate delivery was prevented.",
    walkthrough_blocked: "Walkthrough delivery is blocked by the current recipient, suppression, video, or compliance checks.",
    followup_scheduled: "Future follow-up reminder scheduled. No email was sent.",
    followup_completed: "Follow-up reminder marked complete.",
    followup_invalid: "Choose a valid future follow-up date.",
    followup_blocked: "This reply is not eligible for a future follow-up reminder.",
    reenrich_ready: "Old contact cleared and prospect marked for re-enrichment. No provider call was made.",
    reenrich_blocked: "Re-enrichment action is available only for a Wrong Contact reply.",
    prospect_stopped: "Prospect outreach stopped. This did not add a global unsubscribe suppression.",
    stop_blocked: "Stop action is available only for an Objection reply."
  };
  return result ? copy[result] || "Reply workflow updated." : null;
}

type ReplyRow = {
  id: string;
  client_id: string;
  prospect_id: string;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  classification_status: string;
  classification: string | null;
  classification_confidence: number | null;
  classification_reasons: unknown;
  received_at: Date | string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  outreach_status: string;
  suppression_status: string;
  enrichment_status: string;
  handoff_id: string | null;
  handoff_status: string | null;
  follow_up_id: string | null;
  follow_up_due_at: Date | string | null;
  follow_up_notes: string | null;
  walkthrough_status: string | null;
};

export default async function RepliesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(["STAFF"]);
  const params = await searchParams;
  const selectedParam = typeof params.client === "string" ? params.client : null;
  const result = typeof params.result === "string" ? params.result : null;
  const pool = getPool();

  const clientsResult = await pool.query(
    `SELECT c.id,c.company_name,c.status,
            count(r.id) FILTER (WHERE r.match_status='MATCHED')::int AS matched_replies,
            count(r.id) FILTER (WHERE r.match_status='MATCHED' AND r.classification_status IN ('PENDING','NEEDS_REVIEW'))::int AS needs_review
     FROM connect_clients c
     LEFT JOIN connect_replies r ON r.client_id=c.id
     WHERE c.status IN ('ONBOARDING','READY','ACTIVE','PAUSED')
     GROUP BY c.id,c.company_name,c.status
     ORDER BY count(r.id) FILTER (WHERE r.match_status='MATCHED') DESC,c.company_name`
  );
  const clients = clientsResult.rows;
  const selected = clients.find((client) => client.id === selectedParam)
    ?? clients.find((client) => client.company_name === "ArborLine Connect")
    ?? clients[0]
    ?? null;

  const unmatchedResult = await pool.query(
    `SELECT count(*)::int AS count FROM connect_replies WHERE match_status='UNMATCHED'`
  );

  let rows: ReplyRow[] = [];
  let stats = { matched: 0, needs_review: 0, engaged: 0, scheduled: 0, due: 0 };

  if (selected) {
    const [replyResult, statsResult] = await Promise.all([
      pool.query(
        `SELECT r.id,r.client_id,r.prospect_id,r.from_email,r.subject,r.body_text,
                r.classification_status,r.classification,r.classification_confidence,r.classification_reasons,r.received_at,
                p.company_name,p.contact_name,p.contact_title,p.contact_email,p.outreach_status,p.suppression_status,p.enrichment_status,
                h.id AS handoff_id,h.status AS handoff_status,
                f.id AS follow_up_id,f.due_at AS follow_up_due_at,f.notes AS follow_up_notes,
                w.status AS walkthrough_status
         FROM connect_replies r
         JOIN connect_prospects p ON p.id=r.prospect_id
         LEFT JOIN LATERAL (
           SELECT id,status FROM connect_handoffs
           WHERE reply_id=r.id ORDER BY created_at DESC LIMIT 1
         ) h ON true
         LEFT JOIN LATERAL (
           SELECT id,due_at,notes FROM connect_follow_up_tasks
           WHERE reply_id=r.id AND status='SCHEDULED'
           ORDER BY due_at DESC LIMIT 1
         ) f ON true
         LEFT JOIN LATERAL (
           SELECT status FROM connect_outreach_messages
           WHERE prospect_id=r.prospect_id AND client_id=r.client_id
             AND subject='Your ArborLine 2-minute walkthrough'
             AND status IN ('QUEUED','SENT','DELIVERED')
           ORDER BY created_at DESC LIMIT 1
         ) w ON true
         WHERE r.client_id=$1 AND r.match_status='MATCHED'
         ORDER BY CASE WHEN r.classification_status IN ('PENDING','NEEDS_REVIEW') THEN 0 ELSE 1 END,
                  r.received_at DESC
         LIMIT 75`,
        [selected.id]
      ),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE r.match_status='MATCHED')::int AS matched,
           count(*) FILTER (WHERE r.match_status='MATCHED' AND r.classification_status IN ('PENDING','NEEDS_REVIEW'))::int AS needs_review,
           count(*) FILTER (WHERE r.match_status='MATCHED' AND r.classification IN ('INTERESTED','VIDEO_REQUESTED'))::int AS engaged,
           count(DISTINCT f.id) FILTER (WHERE f.status='SCHEDULED')::int AS scheduled,
           count(DISTINCT f.id) FILTER (WHERE f.status='SCHEDULED' AND f.due_at<=now())::int AS due
         FROM connect_replies r
         LEFT JOIN connect_follow_up_tasks f ON f.reply_id=r.id AND f.status='SCHEDULED'
         WHERE r.client_id=$1`,
        [selected.id]
      )
    ]);
    rows = replyResult.rows as ReplyRow[];
    stats = statsResult.rows[0] ?? stats;
  }

  const notice = resultCopy(result);
  const unmatched = Number(unmatchedResult.rows[0]?.count || 0);

  return (
    <AppShell active="Replies">
      <header>
        <div>
          <p className="eyebrow">INBOUND RESPONSE WORKFLOW</p>
          <h1>Reply Center</h1>
          <p className="muted">Classify replies and take the next safe action. Automatic follow-up sending remains locked.</p>
        </div>
      </header>

      {notice ? <section className="panel" style={{ marginBottom: 12 }}><strong>{notice}</strong></section> : null}

      <section className="grid stats">
        <article className="card"><p>Matched replies</p><h2>{stats.matched}</h2><small>{selected?.company_name || "No client selected"}</small></article>
        <article className="card"><p>Needs review</p><h2>{stats.needs_review}</h2><small>Pending or low-confidence classification</small></article>
        <article className="card"><p>Interested / walkthrough</p><h2>{stats.engaged}</h2><small>Positive reply states</small></article>
        <article className="card"><p>Follow-up reminders</p><h2>{stats.scheduled}</h2><small>{stats.due} due now · sends remain manual</small></article>
      </section>

      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead">
          <div><p className="eyebrow">REPLY CONTROL</p><h3>Work one client at a time</h3></div>
          <span className="status">AUTO FOLLOW-UP LOCKED</span>
        </div>
        <form method="get" className="form">
          <label>Client
            <select name="client" defaultValue={selected?.id ?? ""}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name} · {client.matched_replies} replies</option>)}
            </select>
          </label>
          <button type="submit" className="secondary">View replies</button>
        </form>
        <div className="health" style={{ marginTop: 16 }}>
          <div><span>Automatic follow-up emails</span><b>LOCKED</b></div>
          <div><span>Unmatched inbound messages</span><b>{unmatched}</b></div>
          <div><span>Walkthrough fulfillment</span><b>Explicit staff action only</b></div>
          <div><span>Wrong-contact enrichment spend</span><b>Not triggered here</b></div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><p className="eyebrow">ACTION QUEUE</p><h3>{selected?.company_name || "Replies"}</h3></div>
          {selected ? <Link className="status" href={`/prospects?client=${encodeURIComponent(selected.id)}`}>Client prospects →</Link> : null}
        </div>

        {rows.length ? rows.map((row) => {
          const needsClassification = row.classification_status === "PENDING" || row.classification_status === "NEEDS_REVIEW" || row.classification === "UNKNOWN";
          const due = row.follow_up_due_at ? new Date(row.follow_up_due_at).getTime() <= Date.now() : false;
          return (
            <article className="exception" key={row.id} style={{ alignItems: "flex-start" }}>
              <span className={`severity ${needsClassification ? "review" : row.classification === "UNSUBSCRIBE" ? "high" : ["INTERESTED","VIDEO_REQUESTED"].includes(String(row.classification)) ? "ok" : "docs"}`}>
                {needsClassification ? "REVIEW" : row.classification || "REPLY"}
              </span>
              <div className="grow">
                <strong>{row.company_name} · {row.contact_name || row.from_email}</strong>
                <p>{row.contact_title || "Decision-maker"} · received {formatDate(row.received_at)} CT</p>
                <p><strong>Subject:</strong> {row.subject || "(no subject)"}</p>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, marginTop: 10, fontSize: 13 }}>{row.body_text || "(No reply body available.)"}</div>
                <p style={{ marginTop: 10 }}><Link href={`/prospects/${row.prospect_id}`} className="tableLink">Open prospect →</Link></p>

                {needsClassification ? (
                  <form action={classifyReplyManually} className="form" style={{ marginTop: 14 }}>
                    <input type="hidden" name="replyId" value={row.id} />
                    <label>Staff classification
                      <select name="classification" defaultValue={row.classification && row.classification !== "UNKNOWN" ? row.classification : ""} required>
                        <option value="" disabled>Select the reply intent</option>
                        {CLASSIFICATIONS.map(([value,label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <button type="submit">Save classification</button>
                  </form>
                ) : null}

                {row.classification === "INTERESTED" ? (
                  row.handoff_id ? (
                    <div className="result" style={{ marginTop: 14 }}><strong>Handoff ready.</strong><p><Link href={`/appointments?client=${encodeURIComponent(row.client_id)}`}>Open Appointments pipeline →</Link></p></div>
                  ) : (
                    <form action={createHandoffFromReply} style={{ marginTop: 14 }}><input type="hidden" name="replyId" value={row.id}/><button type="submit">Create handoff</button></form>
                  )
                ) : null}

                {row.classification === "VIDEO_REQUESTED" ? (
                  row.walkthrough_status === "SENT" || row.walkthrough_status === "DELIVERED" ? (
                    <div className="result" style={{ marginTop: 14 }}><strong>Walkthrough fulfilled.</strong><p>Delivery status: {row.walkthrough_status}</p></div>
                  ) : (
                    <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
                      <strong>Real email action.</strong> This button sends the requested walkthrough to {row.from_email}. Opening this page never sends it.
                      <form action={fulfillWalkthroughRequest} style={{ marginTop: 10 }}><input type="hidden" name="replyId" value={row.id}/><button type="submit">Send requested walkthrough</button></form>
                    </div>
                  )
                ) : null}

                {["NOT_NOW","OUT_OF_OFFICE"].includes(String(row.classification)) ? (
                  row.follow_up_id ? (
                    <div className={due ? "notice" : "result"} style={{ marginTop: 14 }}>
                      <strong>{due ? "Follow-up reminder is due." : "Follow-up scheduled."}</strong>
                      <p>{formatDate(row.follow_up_due_at)} CT{row.follow_up_notes ? ` · ${row.follow_up_notes}` : ""}</p>
                      <p className="muted">This reminder never sends an email automatically.</p>
                      <form action={completeReplyFollowUp} style={{ marginTop: 10 }}>
                        <input type="hidden" name="taskId" value={row.follow_up_id}/><input type="hidden" name="clientId" value={row.client_id}/>
                        <button type="submit" className="secondary">Mark reminder complete</button>
                      </form>
                    </div>
                  ) : (
                    <form action={scheduleReplyFollowUp} className="form" style={{ marginTop: 14 }}>
                      <input type="hidden" name="replyId" value={row.id}/>
                      <label>Follow-up date
                        <input type="date" name="followUpDate" required defaultValue={dateInput(row.classification === "OUT_OF_OFFICE" ? 3 : 30)}/>
                      </label>
                      <label>Internal note
                        <input name="notes" maxLength={500} placeholder="Why/when to revisit" />
                      </label>
                      <button type="submit">Schedule reminder — no email sent</button>
                    </form>
                  )
                ) : null}

                {row.classification === "WRONG_CONTACT" ? (
                  !row.contact_email && row.enrichment_status === "PARTIAL" ? (
                    <div className="result" style={{ marginTop: 14 }}><strong>Marked for re-enrichment.</strong><p>No enrichment provider was called by this action.</p></div>
                  ) : (
                    <form action={markWrongContactForReenrichment} style={{ marginTop: 14 }}><input type="hidden" name="replyId" value={row.id}/><button type="submit">Clear old contact + mark for re-enrichment</button></form>
                  )
                ) : null}

                {row.classification === "OBJECTION" ? (
                  <div style={{ marginTop: 14 }}>
                    <p className="muted">Review the objection before stopping outreach. An objection is not treated as an unsubscribe.</p>
                    {row.outreach_status === "STOPPED" ? <span className="status">OUTREACH STOPPED</span> : <form action={stopProspectAfterObjection} style={{ marginTop: 10 }}><input type="hidden" name="replyId" value={row.id}/><button type="submit" className="secondary">Stop outreach to this prospect</button></form>}
                  </div>
                ) : null}

                {row.classification === "UNSUBSCRIBE" ? <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}><strong>Do not contact.</strong> Prospect is suppressed and stopped from outreach.</div> : null}
              </div>
              <span className="status">{row.classification_status.replaceAll("_", " ")}</span>
            </article>
          );
        }) : <div className="empty">No matched replies for this client yet. New replies will appear here after the Resend webhook matches them to outreach.</div>}
      </section>
    </AppShell>
  );
}
