import Link from "next/link";
import { getPool } from "@/lib/db";

const VIDEO_SUBJECTS = ["Your ArborLine 90-second video", "Your ArborLine 2-minute walkthrough"] as const;

type CampaignRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  qualification_status: string;
  outreach_status: string;
  suppression_status: string;
  message_status: string | null;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  message_updated_at: Date | string | null;
  reply_id: string | null;
  classification_status: string | null;
  classification: string | null;
  received_at: Date | string | null;
  video_status: string | null;
  video_updated_at: Date | string | null;
  handoff_id: string | null;
  handoff_status: string | null;
};

type StageState = {
  label: string;
  tone: "high" | "review" | "ok" | "docs";
  actionable: boolean;
  actionLabel?: string;
  actionHref?: string;
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : "—";
}

function formatDate(value: Date | string | null | undefined) {
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

function ageDays(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function campaignState(row: CampaignRow, clientId: string): StageState {
  if (row.message_status === "BOUNCED") return { label: "Stopped · bounced", tone: "high", actionable: true, actionLabel: "Review prospect", actionHref: `/prospects/${row.id}` };
  if (row.message_status === "COMPLAINED") return { label: "Stopped · complaint", tone: "high", actionable: true, actionLabel: "Review prospect", actionHref: `/prospects/${row.id}` };
  if (row.message_status === "FAILED") return { label: "Delivery failed", tone: "high", actionable: true, actionLabel: "Review prospect", actionHref: `/prospects/${row.id}` };
  if (row.suppression_status !== "CLEAR") return { label: `Stopped · ${row.suppression_status.toLowerCase().replaceAll("_", " ")}`, tone: "high", actionable: false };
  if (row.handoff_id || row.outreach_status === "BOOKED") return { label: row.outreach_status === "BOOKED" ? "Booked" : "Handoff active", tone: "ok", actionable: true, actionLabel: "Open Appointments", actionHref: `/appointments?client=${encodeURIComponent(clientId)}` };

  if (row.reply_id) {
    if (row.classification_status === "PENDING" || row.classification_status === "NEEDS_REVIEW") {
      return { label: "Reply needs review", tone: "review", actionable: true, actionLabel: "Open Reply Center", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    }
    if (row.classification === "VIDEO_REQUESTED") {
      if (row.video_status === "DRAFT") return { label: "Video draft awaiting approval", tone: "review", actionable: true, actionLabel: "Review video reply", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
      if (row.video_status === "QUEUED") return { label: "Video approved · queued", tone: "docs", actionable: false };
      if (row.video_status === "SENT" || row.video_status === "DELIVERED") return { label: "90-second video sent", tone: "ok", actionable: false };
      return { label: "Video requested · prepare draft", tone: "review", actionable: true, actionLabel: "Prepare video reply", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    }
    if (row.classification === "INTERESTED") return { label: "Interested · create handoff", tone: "ok", actionable: true, actionLabel: "Open Reply Center", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    if (row.classification === "OBJECTION") return { label: "Objection · review", tone: "review", actionable: true, actionLabel: "Review reply", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    if (row.classification === "NOT_NOW") return { label: "Not now · follow up later", tone: "review", actionable: true, actionLabel: "Review reply", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    if (row.classification === "WRONG_CONTACT") return { label: "Wrong contact · research", tone: "review", actionable: true, actionLabel: "Review reply", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
    if (row.classification === "UNSUBSCRIBE") return { label: "Unsubscribed", tone: "high", actionable: false };
    if (row.classification === "OUT_OF_OFFICE") return { label: "Out of office · wait", tone: "docs", actionable: false };
    return { label: "Reply received · review", tone: "review", actionable: true, actionLabel: "Open Reply Center", actionHref: `/replies?client=${encodeURIComponent(clientId)}` };
  }

  if (row.message_status === "DELIVERED") {
    if (ageDays(row.delivered_at) >= 3) return { label: "Follow-up due · send locked", tone: "review", actionable: true, actionLabel: "Review campaign", actionHref: `/campaigns?performanceClient=${encodeURIComponent(clientId)}` };
    return { label: "Delivered · waiting for reply", tone: "docs", actionable: false };
  }
  if (row.message_status === "SENT") return { label: "Sent · awaiting delivery", tone: "docs", actionable: false };
  if (row.message_status === "QUEUED") return { label: "Queued · awaiting controlled send", tone: "docs", actionable: false };
  if (row.message_status === "DRAFT") return { label: "Draft ready for review", tone: "review", actionable: true, actionLabel: "Review draft", actionHref: "/campaigns" };
  if (!row.contact_email) return { label: "Needs verified buyer email", tone: "review", actionable: true, actionLabel: "Open prospect", actionHref: `/prospects/${row.id}` };
  if (row.outreach_status === "READY") return { label: "Ready for draft", tone: "ok", actionable: true, actionLabel: "Open Campaigns", actionHref: "/campaigns" };
  return { label: row.qualification_status === "QUALIFIED" ? "Qualified · not ready" : row.qualification_status, tone: "docs", actionable: false };
}

function FunnelCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="card"><p>{label}</p><h2>{value}</h2><small>{detail}</small></article>;
}

export async function CampaignPerformancePanel({ selectedClientId, selectedSegmentId }: { selectedClientId?: string | null; selectedSegmentId?: string | null }) {
  const pool = getPool();
  const clientsResult = await pool.query(
    `SELECT c.id,c.company_name,
       count(DISTINCT p.id)::int AS prospect_count,
       count(DISTINCT m.id) FILTER (WHERE m.status <> 'CANCELLED')::int AS message_count,
       count(DISTINCT m.id) FILTER (WHERE m.status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED'))::int AS attempted_count
     FROM connect_clients c
     LEFT JOIN connect_prospects p ON p.client_id=c.id
     LEFT JOIN connect_outreach_messages m ON m.client_id=c.id
     WHERE c.status IN ('ONBOARDING','READY','ACTIVE','PAUSED')
     GROUP BY c.id,c.company_name
     HAVING count(DISTINCT p.id) > 0
     ORDER BY count(DISTINCT m.id) FILTER (WHERE m.status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED')) DESC,
              count(DISTINCT p.id) DESC,c.company_name`
  );
  const clients = clientsResult.rows;
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? clients[0] ?? null;

  if (!selectedClient) {
    return (
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">CAMPAIGN INTELLIGENCE</p><h3>Acquisition funnel</h3></div></div>
        <div className="empty">No Connect campaign data yet.</div>
      </section>
    );
  }

  const segmentsResult = await pool.query(
    `SELECT s.id,s.name,s.slug,s.status,
            count(p.id)::int AS prospect_count
     FROM connect_prospect_segments s
     LEFT JOIN connect_prospects p
       ON p.client_id=s.client_id AND p.source_metadata->>'segment_id'=s.id::text
     WHERE s.client_id=$1
     GROUP BY s.id,s.name,s.slug,s.status
     ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
              count(p.id) DESC,s.name`,
    [selectedClient.id]
  );
  const segments = segmentsResult.rows;
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId)
    ?? segments.find((segment) => segment.status === "ACTIVE")
    ?? segments[0]
    ?? null;

  if (!selectedSegment) {
    return (
      <section className="panel" style={{ marginBottom: 12 }}>
        <div className="panelHead"><div><p className="eyebrow">CAMPAIGN INTELLIGENCE</p><h3>{selectedClient.company_name}</h3></div></div>
        <div className="empty">No campaign segments exist for this client yet.</div>
      </section>
    );
  }

  const [statsResult, rowsResult] = await Promise.all([
    pool.query(
      `WITH prospects AS (
         SELECT p.* FROM connect_prospects p
         WHERE p.client_id=$1 AND p.source_metadata->>'segment_id'=$2
       ), base_messages AS (
         SELECT m.* FROM connect_outreach_messages m
         JOIN prospects p ON p.id=m.prospect_id
         WHERE m.subject <> ALL($3::text[])
       ), video_messages AS (
         SELECT m.* FROM connect_outreach_messages m
         JOIN prospects p ON p.id=m.prospect_id
         WHERE m.subject = ANY($3::text[])
       ), replies AS (
         SELECT r.* FROM connect_replies r
         JOIN prospects p ON p.id=r.prospect_id
       ), handoffs AS (
         SELECT h.* FROM connect_handoffs h
         JOIN prospects p ON p.id=h.prospect_id
       )
       SELECT
         (SELECT count(*) FROM prospects)::int AS prospects,
         (SELECT count(*) FROM prospects WHERE qualification_status='QUALIFIED')::int AS qualified,
         (SELECT count(*) FROM prospects WHERE contact_email IS NOT NULL AND suppression_status='CLEAR')::int AS buyer_covered,
         (SELECT count(*) FROM prospects WHERE outreach_status='READY' AND suppression_status='CLEAR')::int AS ready,
         (SELECT count(*) FROM prospects WHERE outreach_status='NOT_READY' AND qualification_status='QUALIFIED')::int AS research_backlog,
         (SELECT count(DISTINCT prospect_id) FROM base_messages WHERE status='DRAFT')::int AS drafts,
         (SELECT count(DISTINCT prospect_id) FROM base_messages WHERE status='QUEUED')::int AS queued,
         (SELECT count(DISTINCT prospect_id) FROM base_messages WHERE status IN ('SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED'))::int AS contacted,
         (SELECT count(DISTINCT prospect_id) FROM base_messages WHERE status='DELIVERED')::int AS delivered,
         (SELECT count(DISTINCT prospect_id) FROM base_messages WHERE status IN ('BOUNCED','COMPLAINED','FAILED'))::int AS delivery_issues,
         (SELECT count(DISTINCT prospect_id) FROM replies WHERE match_status='MATCHED')::int AS replied,
         (SELECT count(*) FROM replies WHERE match_status='MATCHED' AND classification_status IN ('PENDING','NEEDS_REVIEW'))::int AS replies_needing_review,
         (SELECT count(DISTINCT prospect_id) FROM replies WHERE match_status='MATCHED' AND classification='VIDEO_REQUESTED')::int AS video_requested,
         (SELECT count(DISTINCT prospect_id) FROM video_messages WHERE status='DRAFT')::int AS video_drafts,
         (SELECT count(DISTINCT prospect_id) FROM video_messages WHERE status IN ('SENT','DELIVERED'))::int AS video_sent,
         (SELECT count(DISTINCT prospect_id) FROM replies WHERE match_status='MATCHED' AND classification='INTERESTED')::int AS interested,
         (SELECT count(DISTINCT prospect_id) FROM handoffs)::int AS handoffs,
         (SELECT count(*) FROM prospects WHERE outreach_status='BOOKED')::int AS booked,
         (SELECT count(*) FROM prospects WHERE suppression_status='UNSUBSCRIBED')::int AS unsubscribed,
         (SELECT count(*) FROM prospects WHERE suppression_status IN ('BOUNCED','COMPLAINT'))::int AS reputation_suppressions`,
      [selectedClient.id, selectedSegment.id, [...VIDEO_SUBJECTS]]
    ),
    pool.query(
      `WITH prospects AS (
         SELECT p.* FROM connect_prospects p
         WHERE p.client_id=$1 AND p.source_metadata->>'segment_id'=$2
       )
       SELECT p.id,p.company_name,p.contact_name,p.contact_title,p.contact_email,
              p.qualification_status,p.outreach_status,p.suppression_status,
              m.status AS message_status,m.sent_at,m.delivered_at,m.updated_at AS message_updated_at,
              r.id AS reply_id,r.classification_status,r.classification,r.received_at,
              v.status AS video_status,v.updated_at AS video_updated_at,
              h.id AS handoff_id,h.status AS handoff_status
       FROM prospects p
       LEFT JOIN LATERAL (
         SELECT status,sent_at,delivered_at,updated_at
         FROM connect_outreach_messages
         WHERE prospect_id=p.id AND client_id=p.client_id
           AND subject <> ALL($3::text[]) AND status <> 'CANCELLED'
         ORDER BY COALESCE(sent_at,updated_at) DESC,created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT id,classification_status,classification,received_at
         FROM connect_replies
         WHERE prospect_id=p.id AND client_id=p.client_id AND match_status='MATCHED'
         ORDER BY received_at DESC,created_at DESC
         LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT status,updated_at
         FROM connect_outreach_messages
         WHERE prospect_id=p.id AND client_id=p.client_id
           AND subject = ANY($3::text[]) AND status <> 'CANCELLED'
         ORDER BY created_at DESC LIMIT 1
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT id,status FROM connect_handoffs
         WHERE prospect_id=p.id AND client_id=p.client_id
         ORDER BY created_at DESC LIMIT 1
       ) h ON true
       ORDER BY
         CASE
           WHEN r.classification_status IN ('PENDING','NEEDS_REVIEW') THEN 0
           WHEN r.classification='VIDEO_REQUESTED' AND COALESCE(v.status,'') NOT IN ('SENT','DELIVERED') THEN 1
           WHEN r.classification='INTERESTED' AND h.id IS NULL THEN 2
           WHEN m.status IN ('BOUNCED','COMPLAINED','FAILED') THEN 3
           WHEN m.status='DRAFT' THEN 4
           WHEN p.contact_email IS NULL THEN 5
           ELSE 6
         END,
         COALESCE(r.received_at,m.delivered_at,m.sent_at,m.updated_at,p.updated_at) DESC
       LIMIT 75`,
      [selectedClient.id, selectedSegment.id, [...VIDEO_SUBJECTS]]
    )
  ]);

  const stats = statsResult.rows[0] ?? {};
  const rows = rowsResult.rows as CampaignRow[];
  const prospects = Number(stats.prospects || 0);
  const qualified = Number(stats.qualified || 0);
  const buyerCovered = Number(stats.buyer_covered || 0);
  const drafts = Number(stats.drafts || 0);
  const contacted = Number(stats.contacted || 0);
  const delivered = Number(stats.delivered || 0);
  const replied = Number(stats.replied || 0);
  const videoRequested = Number(stats.video_requested || 0);
  const videoSent = Number(stats.video_sent || 0);
  const interested = Number(stats.interested || 0);
  const booked = Number(stats.booked || 0);
  const actionCount = rows.filter((row) => campaignState(row, selectedClient.id).actionable).length;
  const followUpDue = rows.filter((row) => campaignState(row, selectedClient.id).label.startsWith("Follow-up due")).length;

  return (
    <section className="panel" style={{ marginBottom: 12 }}>
      <div className="panelHead">
        <div>
          <p className="eyebrow">CAMPAIGN INTELLIGENCE</p>
          <h3>{selectedSegment.name} acquisition funnel</h3>
        </div>
        <span className="status">{actionCount} next action{actionCount === 1 ? "" : "s"}</span>
      </div>
      <p className="muted">Segment-level funnel from sourced prospect through booked opportunity. All counts are live; video and follow-up sends remain approval-gated.</p>

      <form method="get" className="form" style={{ marginTop: 14, marginBottom: 16 }}>
        <div className="formGrid">
          <label>Client
            <select name="performanceClient" defaultValue={selectedClient.id}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name} · {client.prospect_count} prospects</option>)}
            </select>
          </label>
          <label>Campaign segment
            <select name="performanceSegment" defaultValue={selectedSegment.id}>
              {segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name} · {segment.prospect_count} prospects · {segment.status}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="secondary" style={{ marginTop: 12 }}>View campaign</button>
      </form>

      <div className="grid stats" style={{ marginBottom: 12 }}>
        <FunnelCard label="Prospects" value={prospects} detail="In this segment" />
        <FunnelCard label="Qualified" value={qualified} detail={`${percent(qualified, prospects)} qualification rate`} />
        <FunnelCard label="Buyer coverage" value={buyerCovered} detail={`${percent(buyerCovered, prospects)} have verified email`} />
        <FunnelCard label="Drafts ready" value={drafts} detail="Awaiting your review" />
      </div>
      <div className="grid stats" style={{ marginBottom: 16 }}>
        <FunnelCard label="Contacted" value={contacted} detail={`${percent(contacted, buyerCovered)} of contactable buyers`} />
        <FunnelCard label="Delivered" value={delivered} detail={`${percent(delivered, contacted)} delivery rate`} />
        <FunnelCard label="Replied" value={replied} detail={`${percent(replied, delivered)} reply rate`} />
        <FunnelCard label="Booked" value={booked} detail={`${percent(booked, delivered)} delivered → booked`} />
      </div>

      <div className="panelHead" style={{ marginTop: 4 }}>
        <div><p className="eyebrow">90-SECOND VIDEO FUNNEL</p><h3>What happens after a positive reply</h3></div>
      </div>
      <div className="health" style={{ marginBottom: 16 }}>
        <div><span>Video requested</span><b>{videoRequested}</b></div>
        <div><span>Video drafts awaiting approval</span><b>{stats.video_drafts ?? 0}</b></div>
        <div><span>Video sent</span><b>{videoSent}</b></div>
        <div><span>Interested / wants to talk</span><b>{interested}</b></div>
        <div><span>Handoffs created</span><b>{stats.handoffs ?? 0}</b></div>
        <div><span>Booked</span><b>{booked}</b></div>
      </div>

      <div className="panelHead" style={{ marginTop: 4 }}>
        <div><p className="eyebrow">NEXT ACTIONS</p><h3>What needs attention</h3></div>
        <Link href={`/prospects?client=${encodeURIComponent(selectedClient.id)}`} className="status">Segment prospects →</Link>
      </div>
      <div className="health" style={{ marginBottom: 16 }}>
        <div><span>Drafts awaiting review</span><b>{drafts}</b></div>
        <div><span>Buyer-email research backlog</span><b>{stats.research_backlog ?? 0}</b></div>
        <div><span>Replies needing review</span><b>{stats.replies_needing_review ?? 0}</b></div>
        <div><span>Video approvals waiting</span><b>{stats.video_drafts ?? 0}</b></div>
        <div><span>Follow-up due (automation locked)</span><b>{followUpDue}</b></div>
        <div><span>Delivery issues</span><b>{stats.delivery_issues ?? 0}</b></div>
        <div><span>Unsubscribed</span><b>{stats.unsubscribed ?? 0}</b></div>
        <div><span>Bounce / complaint suppressions</span><b>{stats.reputation_suppressions ?? 0}</b></div>
      </div>

      <div className="panelHead" style={{ marginTop: 4 }}>
        <div><p className="eyebrow">LIVE PROSPECT PIPELINE</p><h3>{selectedSegment.name} · {selectedClient.company_name}</h3></div>
        <span className="status">{selectedSegment.status}</span>
      </div>

      {rows.length ? rows.map((row) => {
        const state = campaignState(row, selectedClient.id);
        const activityAt = row.received_at ?? row.video_updated_at ?? row.delivered_at ?? row.sent_at ?? row.message_updated_at;
        return (
          <article className="exception" key={row.id} style={{ alignItems: "flex-start" }}>
            <span className={`severity ${state.tone}`}>{state.actionable ? "ACTION" : "STATE"}</span>
            <div className="grow">
              <strong>{row.company_name} · {row.contact_name || row.contact_email || "Buyer research pending"}</strong>
              <p>{row.contact_title || "Decision-maker not verified"} · {row.contact_email || "No verified buyer email"}</p>
              <p className="muted">
                Qualification: {row.qualification_status} · Outreach: {row.outreach_status}
                {row.message_status ? ` · Email: ${row.message_status}` : ""}
                {row.reply_id ? ` · Reply: ${row.classification || row.classification_status || "received"}` : ""}
                {activityAt ? ` · ${formatDate(activityAt)} CT` : ""}
              </p>
              {state.actionHref && state.actionLabel ? <p style={{ marginTop: 8 }}><Link href={state.actionHref}>{state.actionLabel} →</Link></p> : null}
            </div>
            <span className="status">{state.label}</span>
          </article>
        );
      }) : <div className="empty">No prospects are tagged to this campaign segment yet.</div>}
    </section>
  );
}
