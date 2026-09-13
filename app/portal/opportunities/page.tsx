import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const { client } = await requireConnectClient();
  const { rows } = await getPool().query(`
    SELECT p.id,p.company_name,p.city,p.state,p.contact_name,p.contact_title,
           p.qualification_score,p.qualification_reasons,p.buying_signals,p.outreach_status,
           h.status AS handoff_status,h.booking_type,h.summary,h.suggested_next_step,h.scheduled_for
    FROM connect_prospects p
    LEFT JOIN LATERAL (
      SELECT status,booking_type,summary,suggested_next_step,scheduled_for
      FROM connect_handoffs h WHERE h.prospect_id=p.id
      ORDER BY h.created_at DESC LIMIT 1
    ) h ON true
    WHERE p.client_id=$1 AND p.qualification_status='QUALIFIED'
    ORDER BY p.qualification_score DESC NULLS LAST,p.updated_at DESC
    LIMIT 100
  `,[client.id]);

  return <PortalShell active="Opportunities">
    <header className={styles.header}><div><p className={styles.eyebrow}>QUALIFIED OPPORTUNITIES</p><h1>Opportunities</h1><p className={styles.muted}>The companies ArborLine believes are worth your team’s attention.</p></div><span className={styles.badge}>{rows.length} QUALIFIED</span></header>
    <section className={styles.panel}>
      {rows.length ? <div className={styles.list}>{rows.map((row) => <article className={styles.item} key={row.id}>
        <div className={styles.itemTop}><div><strong>{row.company_name}</strong><p>{[row.city,row.state].filter(Boolean).join(", ") || "Location unavailable"} · {row.contact_name || "Decision maker"}{row.contact_title ? ` — ${row.contact_title}` : ""}</p></div><span className={styles.score}>{row.qualification_score ?? "—"}%</span></div>
        <div className={styles.tags}>
          <span className={styles.tag}>{row.handoff_status || row.outreach_status}</span>
          {row.booking_type ? <span className={styles.tag}>{row.booking_type}</span> : null}
          {(row.buying_signals || []).slice(0,3).map((signal: string) => <span className={styles.tag} key={signal}>{signal}</span>)}
        </div>
        {row.summary ? <p><strong>Why this matters:</strong> {row.summary}</p> : null}
        {row.suggested_next_step ? <p><strong>Next step:</strong> {row.suggested_next_step}</p> : null}
        <div className={styles.itemActions}><a className={styles.secondaryButton} href={`/portal/opportunities/${row.id}`}>View opportunity</a></div>
      </article>)}</div> : <div className={styles.empty}>No qualified opportunities yet. ArborLine will add them here as prospects pass your qualification rules.</div>}
    </section>
  </PortalShell>;
}
