import Link from "next/link";
import { getPool } from "@/lib/db";

type PerformanceRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  outreach_status: string;
  suppression_status: string;
  message_status: string;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  message_updated_at: Date | string;
  reply_id: string | null;
  reply_match_status: string | null;
  classification_status: string | null;
  classification: string | null;
  received_at: Date | string | null;
  handoff_id: string | null;
  handoff_status: string | null;
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : "—";
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago"
  }).format(date);
}

function ageDays(value: Date | string | null) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function followUpState(row: PerformanceRow) {
  if (row.message_status === "BOUNCED") return { label: "Stopped · bounced", tone: "high", actionable: true };
  if (row.message_status === "COMPLAINED") return { label: "Stopped · complaint", tone: "high", actionable: true };
  if (row.message_status === "FAILED") return { label: "Delivery failed", tone: "high", actionable: true };
  if (row.suppression_status !== "CLEAR") return { label: `Stopped · ${row.suppression_status.toLowerCase().replaceAll("_", " ")}`, tone: "high", actionable: false };
  if (row.handoff_id || row.outreach_status === "BOOKED") return { label: "Handoff active", tone: "ok", actionable: true };
  if (row.reply_id) {
    if (row.classification_status === "PENDING" || row.classification_status === "NEEDS_REVIEW") return { label: "Reply needs review", tone: "review", actionable: true };
    if (row.classification === "INTERESTED") return { label: "Interested", tone: "ok", actionable: true };
    if (row.classification === "VIDEO_REQUESTED") return { label: "Video requested", tone: "ok", actionable: true };
    if (row.classification === "OBJECTION") return { label: "Objection · review", tone: "review", actionable: true };
    if (row.classification === "NOT_NOW") return { label: "Not now · follow up later", tone: "review", actionable: true };
    if (row.classification === "WRONG_CONTACT") return { label: "Wrong contact", tone: "review", actionable: true };
    if (row.classification === "UNSUBSCRIBE") return { label: "Unsubscribe reply", tone: "high", actionable: true };
    if (row.classification === "OUT_OF_OFFICE") return { label: "Out of office · wait", tone: "docs", actionable: false };
    return { label: "Reply received · review", tone: "review", actionable: true };
  }
  if (row.message_status === "QUEUED") return { label: "Queued · awaiting send", tone: "docs", actionable: false };
  if (row.message_status === "SENT") return { label: "Sent · awaiting delivery", tone: "docs", actionable: false };
  if (row.message_status === "DELIVERED") {
    if (ageDays(row.delivered_at) >= 3) return { label: "Follow-up due · automation locked", tone: "review", actionable: true };
    return { label: "Waiting for reply", tone: "docs", actionable: false };
  }
  return { label: row.message_status, tone: "docs", actionable: false };
}

export async function CampaignPerformancePanel({ selectedClientId }: { selectedClientId?: string | null }) {
  const pool = getPool();
  const clientsResult = await pool.query(
    `SELECT c.id,c.company_name,
       count(m.id) FILTER (WHERE m.status <> 'CANCELLED')::int AS message_count,
       count(m.id) FILTER (WHERE m.status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED'))::int AS attempted_count
     FROM connect_clients c
     LEFT JOIN connect_outreach_messages m ON m.client_id=c.id
     GROUP BY c.id,c.company_name
     HAVING count(m.id) FILTER (WHERE m.status <> 'CANCELLED') > 0
     ORDER BY count(m.id) FILTER (WHERE m.status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED')) DESC,
              c.company_name`
  );
  const clients = clientsResult.rows;
  const selected = clients.find((client) => client.id === selectedClientId) ?? clients[0] ?? null;

  if (!selected) {
    return (
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">OUTREACH PERFORMANCE</p><h3>Delivery + reply control</h3></div></div>
        <div className="empty">No Connect outreach activity yet.</div>
      </section>
    );
  }

  const [statsResult, rowsResult] = await Promise.all([
    pool.query(
      `WITH outbound AS (
         SELECT
           count(*) FILTER (WHERE status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED'))::int AS attempts,
           count(*) FILTER (WHERE status='DELIVERED')::int AS delivered,
           count(*) FILTER (WHERE status='SENT')::int AS awaiting_delivery,
           count(*) FILTER (WHERE status='QUEUED')::int AS queued,
           count(*) FILTER (WHERE status='BOUNCED')::int AS bounced,
           count(*) FILTER (WHERE status='COMPLAINED')::int AS complained,
           count(*) FILTER (WHERE status='FAILED')::int AS failed,
           count(DISTINCT prospect_id) FILTER (WHERE status='DELIVERED')::int AS delivered_prospects
         FROM connect_outreach_messages WHERE client_id=$1
       ), replies AS (
         SELECT
           count(DISTINCT prospect_id) FILTER (WHERE match_status='MATCHED')::int AS replied_prospects,
           count(DISTINCT prospect_id) FILTER (WHERE match_status='MATCHED' AND classification IN ('INTERESTED','VIDEO_REQUESTED'))::int AS engaged_prospects,
           count(*) FILTER (WHERE match_status='MATCHED' AND classification_status IN ('PENDING','NEEDS_REVIEW'))::int AS replies_needing_review
         FROM connect_replies WHERE client_id=$1
       ), suppressed AS (
         SELECT
           count(*) FILTER (WHERE suppression_status='UNSUBSCRIBED')::int AS unsubscribed,
           count(*) FILTER (WHERE suppression_status='BOUNCED')::int AS suppressed_bounced,
           count(*) FILTER (WHERE suppression_status='COMPLAINT')::int AS suppressed_complaint
         FROM connect_prospects WHERE client_id=$1
       )
       SELECT outbound.*,replies.*,suppressed.* FROM outbound,replies,suppressed`,
      [selected.id]
    ),
    pool.query(
      `SELECT p.id,p.company_name,p.contact_name,p.contact_title,p.contact_email,p.outreach_status,p.suppression_status,
              m.status AS message_status,m.sent_at,m.delivered_at,m.updated_at AS message_updated_at,
              r.id AS reply_id,r.match_status AS reply_match_status,r.classification_status,r.classification,r.received_at,
              h.id AS handoff_id,h.status AS handoff_status
       FROM connect_prospects p
       JOIN LATERAL (
         SELECT id,status,sent_at,delivered_at,updated_at
         FROM connect_outreach_messages
         WHERE prospect_id=p.id AND client_id=p.client_id
           AND status IN ('QUEUED','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED')
         ORDER BY COALESCE(sent_at,updated_at) DESC,created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT id,match_status,classification_status,classification,received_at
         FROM connect_replies
         WHERE prospect_id=p.id AND client_id=p.client_id
         ORDER BY received_at DESC,created_at DESC
         LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT id,status FROM connect_handoffs
         WHERE prospect_id=p.id AND client_id=p.client_id
         ORDER BY created_at DESC LIMIT 1
       ) h ON true
       WHERE p.client_id=$1
       ORDER BY COALESCE(r.received_at,m.delivered_at,m.sent_at,m.updated_at) DESC
       LIMIT 40`,
      [selected.id]
    )
  ]);

  const stats = statsResult.rows[0] ?? {};
  const rows = rowsResult.rows as PerformanceRow[];
  const attempts = Number(stats.attempts || 0);
  const delivered = Number(stats.delivered || 0);
  const deliveredProspects = Number(stats.delivered_prospects || 0);
  const repliedProspects = Number(stats.replied_prospects || 0);
  const engagedProspects = Number(stats.engaged_prospects || 0);
  const issueCount = Number(stats.bounced || 0) + Number(stats.complained || 0) + Number(stats.failed || 0);
  const followUpDue = rows.filter((row) => followUpState(row).label.startsWith("Follow-up due")).length;
  const actionCount = rows.filter((row) => followUpState(row).actionable).length;

  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panelHead">
        <div><p className="eyebrow">OUTREACH PERFORMANCE</p><h3>Delivery + reply control</h3></div>
        <span className="status">{actionCount} need attention</span>
      </div>
      <p className="muted">Live delivery and reply health by client. Follow-up automation remains locked; due items are surfaced for review only.</p>

      <form method="get" className="form" style={{ marginTop: 14, marginBottom: 14 }}>
        <label>
          Performance client
          <select name="performanceClient" defaultValue={selected.id}>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name} · {client.message_count} messages</option>)}
          </select>
        </label>
        <button type="submit" className="secondary">View performance</button>
      </form>

      <div className="grid stats">
        <article className="card"><p>Delivery rate</p><h2>{percent(delivered, attempts)}</h2><small>{delivered} delivered / {attempts} attempted</small></article>
        <article className="card"><p>Reply rate</p><h2>{percent(repliedProspects, deliveredProspects)}</h2><small>{repliedProspects} replying prospects / {deliveredProspects} delivered</small></article>
        <article className="card"><p>Interested / engaged</p><h2>{engagedProspects}</h2><small>Interested or requested the walkthrough</small></article>
        <article className="card"><p>Follow-up due</p><h2>{followUpDue}</h2><small>Delivered 72h+ with no reply</small></article>
      </div>

      <div className="health" style={{ marginBottom: 16 }}>
        <div><span>Queued</span><b>{stats.queued ?? 0}</b></div>
        <div><span>Sent · awaiting delivery</span><b>{stats.awaiting_delivery ?? 0}</b></div>
        <div><span>Delivery issues</span><b>{issueCount}</b></div>
        <div><span>Replies needing classification/review</span><b>{stats.replies_needing_review ?? 0}</b></div>
        <div><span>Unsubscribed</span><b>{stats.unsubscribed ?? 0}</b></div>
        <div><span>Bounce / complaint suppressions</span><b>{Number(stats.suppressed_bounced || 0) + Number(stats.suppressed_complaint || 0)}</b></div>
        <div><span>Automatic follow-up</span><b>LOCKED</b></div>
      </div>

      <div className="panelHead" style={{ marginTop: 8 }}>
        <div><p className="eyebrow">PROSPECT FOLLOW-UP STATE</p><h3>{selected.company_name}</h3></div>
        <Link href={`/prospects?client=${encodeURIComponent(selected.id)}`} className="status">Client prospects →</Link>
      </div>

      {rows.length ? rows.map((row) => {
        const state = followUpState(row);
        const activityAt = row.received_at ?? row.delivered_at ?? row.sent_at ?? row.message_updated_at;
        return (
          <article className="exception" key={row.id} style={{ alignItems: "flex-start" }}>
            <span className={`severity ${state.tone}`}>{state.actionable ? "ACTION" : "STATE"}</span>
            <div className="grow">
              <strong>{row.company_name} · {row.contact_name || row.contact_email || "Unknown contact"}</strong>
              <p>{row.contact_title || "Decision-maker"} · {row.contact_email || "No email"}</p>
              <p className="muted">Latest outbound: {row.message_status} · {formatDate(activityAt)} CT{row.reply_id ? ` · reply ${row.classification_status?.toLowerCase().replaceAll("_", " ") || "received"}` : ""}</p>
              {row.handoff_id ? <p><Link href={`/appointments?client=${encodeURIComponent(selected.id)}`}>Open handoff pipeline →</Link></p> : null}
            </div>
            <span className="status">{state.label}</span>
          </article>
        );
      }) : <div className="empty">No queued or attempted outreach for this client.</div>}
    </section>
  );
}
