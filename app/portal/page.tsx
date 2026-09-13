import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "./PortalShell";
import { ScoreRing } from "./ScoreRing";
import styles from "./portal.module.css";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

export default async function PortalDashboard() {
  const { client } = await requireConnectClient();
  const pool = getPool();

  const [statsResult,attentionResult,opportunitiesResult,activityResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*)::int FROM connect_prospects WHERE client_id=$1) AS discovered,
        (SELECT count(*)::int FROM connect_prospects WHERE client_id=$1 AND qualification_status='QUALIFIED') AS qualified,
        (SELECT count(*)::int FROM connect_replies WHERE client_id=$1 AND match_status='MATCHED') AS replies,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_id=$1) AS handoffs,
        (SELECT count(*)::int FROM connect_outreach_messages WHERE client_id=$1 AND status IN ('SENT','DELIVERED')) AS outreach,
        (SELECT count(*)::int FROM connect_handoffs WHERE client_id=$1 AND status IN ('SCHEDULED','HELD','CLOSED')) AS booked
    `,[client.id]),
    pool.query(`
      SELECT h.id,h.status,h.booking_type,h.company_name,h.contact_name,h.summary,
             h.suggested_next_step,h.scheduled_for,h.prospect_id,p.qualification_score
      FROM connect_handoffs h
      LEFT JOIN connect_prospects p ON p.id=h.prospect_id
      WHERE h.client_id=$1 AND h.status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED')
      ORDER BY CASE h.status WHEN 'READY_FOR_REVIEW' THEN 0 WHEN 'SCHEDULING' THEN 1 ELSE 2 END,
               COALESCE(h.scheduled_for,h.created_at) ASC
      LIMIT 6
    `,[client.id]),
    pool.query(`
      SELECT p.id,p.company_name,p.contact_name,p.contact_title,p.city,p.state,p.qualification_score,p.outreach_status,
             h.status AS handoff_status,h.booking_type,h.suggested_next_step
      FROM connect_prospects p
      LEFT JOIN LATERAL (
        SELECT status,booking_type,suggested_next_step
        FROM connect_handoffs h WHERE h.prospect_id=p.id
        ORDER BY h.created_at DESC LIMIT 1
      ) h ON true
      WHERE p.client_id=$1 AND p.qualification_status='QUALIFIED'
      ORDER BY p.updated_at DESC,p.qualification_score DESC NULLS LAST
      LIMIT 5
    `,[client.id]),
    pool.query(`
      SELECT * FROM (
        SELECT r.received_at AS happened_at,'REPLY'::text AS type,p.company_name,
               COALESCE(r.classification,'REVIEW')::text AS status,
               COALESCE(NULLIF(r.subject,''),left(COALESCE(r.body_text,''),120)) AS detail,
               p.id AS prospect_id
        FROM connect_replies r
        JOIN connect_prospects p ON p.id=r.prospect_id
        WHERE r.client_id=$1 AND r.match_status='MATCHED'
        UNION ALL
        SELECT COALESCE(h.scheduled_for,h.created_at) AS happened_at,'HANDOFF'::text AS type,h.company_name,
               h.status::text AS status,
               COALESCE(h.suggested_next_step,h.summary) AS detail,
               h.prospect_id
        FROM connect_handoffs h
        WHERE h.client_id=$1
      ) activity
      ORDER BY happened_at DESC
      LIMIT 6
    `,[client.id])
  ]);

  const stats = statsResult.rows[0] || {};
  const campaignActive = client.status === "ACTIVE";

  return <PortalShell active="Dashboard">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ARBORLINE CONNECT CLIENT PORTAL</p><h1>{client.company_name}</h1><p className={styles.muted}>Your qualified business-development pipeline at a glance.</p></div>
      <span className={styles.campaignBadge}><span className={`${styles.statusDot} ${campaignActive ? styles.statusDotActive : ""}`}/>{campaignActive ? "Campaign active" : label(client.status)}</span>
    </header>

    <section className={styles.stats}>
      <article className={styles.card}><p>Businesses discovered</p><h2>{stats.discovered ?? 0}</h2><small>Matched to your target profile</small></article>
      <article className={styles.card}><p>Qualified matches</p><h2>{stats.qualified ?? 0}</h2><small>Passed your qualification floor</small></article>
      <article className={styles.card}><p>Replies received</p><h2>{stats.replies ?? 0}</h2><small>Matched prospect responses</small></article>
      <article className={styles.card}><p>Qualified handoffs</p><h2>{stats.handoffs ?? 0}</h2><small>Real next steps surfaced</small></article>
    </section>

    <section className={styles.grid2}>
      <article className={styles.panel}>
        <div className={styles.sectionTitle}><h2>Needs your attention</h2><a className={styles.secondaryButton} href="/portal/appointments">View appointments</a></div>
        {attentionResult.rows.length ? <div className={styles.list}>{attentionResult.rows.map((row) => <div className={styles.item} key={row.id}>
          <div className={styles.itemTop}><div><strong>{row.company_name}</strong><p>{row.contact_name || "Prospect"}{row.scheduled_for ? ` · ${new Date(row.scheduled_for).toLocaleString()}` : ""}</p></div><span className={styles.pill}>{label(row.status)}</span></div>
          <p>{row.suggested_next_step || row.summary}</p>
          <div className={styles.itemActions}><a className={styles.textLink} href={`/portal/opportunities/${row.prospect_id}`}>Open opportunity →</a></div>
        </div>)}</div> : <div className={styles.empty}>Nothing needs your attention right now. ArborLine is continuing to work the pipeline.</div>}
      </article>

      <aside className={styles.panel}>
        <h2>Campaign activity</h2>
        <div className={styles.facts}>
          <div><small>Outreach sent</small><strong>{stats.outreach ?? 0}</strong></div>
          <div><small>Replies</small><strong>{stats.replies ?? 0}</strong></div>
          <div><small>Handoffs</small><strong>{stats.handoffs ?? 0}</strong></div>
          <div><small>Booked / held</small><strong>{stats.booked ?? 0}</strong></div>
        </div>
        <p className={styles.muted} style={{marginTop:16}}>ArborLine keeps discovery and qualification running in the background. You only need to step in when a real opportunity is ready.</p>
      </aside>
    </section>

    <section className={styles.grid2} style={{marginTop:16}}>
      <article className={styles.panel}>
        <div className={styles.sectionTitle}><h2>Latest opportunities</h2><a className={styles.button} href="/portal/opportunities">View all</a></div>
        {opportunitiesResult.rows.length ? opportunitiesResult.rows.map((row) => <div className={styles.row} key={row.id}>
          <div><strong>{row.company_name}</strong><small>{[row.city,row.state].filter(Boolean).join(", ") || row.contact_name || "Qualified account"}</small></div>
          <div><span className={styles.pill}>{label(row.handoff_status || row.outreach_status)}</span><small>{row.suggested_next_step || row.contact_title || "ArborLine is working this opportunity"}</small></div>
          <div className={styles.score}><ScoreRing score={row.qualification_score} href={`/portal/opportunities/${row.id}`} label="qualification match"/></div>
        </div>) : <div className={styles.empty}>Qualified opportunities will appear here as ArborLine creates them.</div>}
      </article>

      <aside className={styles.panel}>
        <div className={styles.sectionTitle}><h2>Recent activity</h2><a className={styles.textLink} href="/portal/conversations">Conversations</a></div>
        {activityResult.rows.length ? <div className={styles.timeline}>{activityResult.rows.map((row,index) => <div className={styles.timelineItem} key={`${row.type}-${row.prospect_id}-${index}`}>
          <span className={styles.timelineDot}/>
          <div><div className={styles.itemTop}><strong>{row.company_name}</strong><span className={styles.pill}>{label(row.status)}</span></div><p>{row.detail || label(row.type)}</p><small>{row.happened_at ? new Date(row.happened_at).toLocaleString() : ""}</small></div>
        </div>)}</div> : <div className={styles.empty}>Reply and handoff activity will appear here automatically.</div>}
      </aside>
    </section>
  </PortalShell>;
}
