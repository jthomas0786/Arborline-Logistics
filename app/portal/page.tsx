import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "./PortalShell";
import styles from "./portal.module.css";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const { client } = await requireConnectClient();
  const pool = getPool();

  const [statsResult, handoffsResult] = await Promise.all([
    pool.query(`
      SELECT
        count(*)::int AS discovered,
        count(*) FILTER (WHERE qualification_status='QUALIFIED')::int AS qualified,
        count(*) FILTER (WHERE contact_email IS NOT NULL)::int AS decision_makers,
        count(*) FILTER (WHERE outreach_status IN ('CONTACTED','REPLIED','BOOKED'))::int AS conversations,
        count(*) FILTER (WHERE outreach_status='BOOKED')::int AS booked
      FROM connect_prospects WHERE client_id=$1
    `,[client.id]),
    pool.query(`
      SELECT h.id,h.status,h.booking_type,h.company_name,h.contact_name,h.summary,
             h.suggested_next_step,h.scheduled_for,p.qualification_score
      FROM connect_handoffs h
      LEFT JOIN connect_prospects p ON p.id=h.prospect_id
      WHERE h.client_id=$1
      ORDER BY h.created_at DESC LIMIT 5
    `,[client.id])
  ]);

  const stats = statsResult.rows[0] || {};

  return <PortalShell active="Dashboard">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ARBORLINE CONNECT CLIENT PORTAL</p><h1>{client.company_name}</h1><p className={styles.muted}>Your qualified business-development pipeline at a glance.</p></div>
      <span className={styles.badge}>● {client.status === "ACTIVE" ? "Campaign active" : client.status}</span>
    </header>

    <section className={styles.stats}>
      <article className={styles.card}><p>Businesses discovered</p><h2>{stats.discovered ?? 0}</h2><small>Matched to your target profile</small></article>
      <article className={styles.card}><p>Qualified matches</p><h2>{stats.qualified ?? 0}</h2><small>Meet your qualification floor</small></article>
      <article className={styles.card}><p>Decision-makers found</p><h2>{stats.decision_makers ?? 0}</h2><small>Work contacts available</small></article>
      <article className={styles.card}><p>Conversations started</p><h2>{stats.conversations ?? 0}</h2><small>Contacted, replied, or booked</small></article>
    </section>

    <section className={styles.grid2}>
      <article className={styles.panel}>
        <div className={styles.sectionTitle}><h2>Latest opportunities</h2><a className={styles.button} href="/portal/opportunities">View all</a></div>
        {handoffsResult.rows.length ? handoffsResult.rows.map((row) => <div className={styles.row} key={row.id}>
          <div><strong>{row.company_name}</strong><small>{row.contact_name || "Decision maker"}</small></div>
          <div><span className={styles.pill}>{row.booking_type}</span><small>{row.suggested_next_step || row.summary || row.status}</small></div>
          <div className={styles.score}>{row.qualification_score ? `${row.qualification_score}%` : row.status}</div>
        </div>) : <div className={styles.empty}>Qualified opportunities will appear here as ArborLine creates them.</div>}
      </article>

      <aside className={styles.panel}>
        <h2>What ArborLine is doing</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>Finding matching companies</strong><p>Searching against your industry, geography, facility, and size criteria.</p></div>
          <div className={styles.item}><strong>Qualifying before handoff</strong><p>Filtering for the right company, right person, and a credible reason to talk.</p></div>
          <div className={styles.item}><strong>Surfacing real next steps</strong><p>You see opportunities and appointments—not internal worker queues or raw provider data.</p></div>
        </div>
      </aside>
    </section>
  </PortalShell>;
}
