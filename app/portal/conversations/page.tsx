import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const { client } = await requireConnectClient();
  const { rows } = await getPool().query(`
    SELECT r.id,r.classification,r.classification_confidence,r.subject,r.body_text,r.received_at,
           p.company_name,p.contact_name,p.contact_title
    FROM connect_replies r
    JOIN connect_prospects p ON p.id=r.prospect_id
    WHERE r.client_id=$1 AND r.match_status='MATCHED'
    ORDER BY r.received_at DESC
    LIMIT 100
  `,[client.id]);

  return <PortalShell active="Conversations">
    <header className={styles.header}><div><p className={styles.eyebrow}>PROSPECT RESPONSES</p><h1>Conversations</h1><p className={styles.muted}>Replies from matched prospects, organized by ArborLine so you can focus on the conversations that matter.</p></div><span className={styles.badge}>{rows.length} RECENT</span></header>
    <section className={styles.panel}>
      {rows.length ? <div className={styles.list}>{rows.map((row) => <article className={styles.item} key={row.id}>
        <div className={styles.itemTop}><div><strong>{row.company_name}</strong><p>{row.contact_name || "Prospect"}{row.contact_title ? ` · ${row.contact_title}` : ""}</p></div><span className={styles.pill}>{row.classification || "REVIEW"}</span></div>
        {row.subject ? <p><strong>{row.subject}</strong></p> : null}
        <p>{String(row.body_text || "").slice(0,500)}{String(row.body_text || "").length > 500 ? "…" : ""}</p>
        <small className={styles.muted}>{row.received_at ? new Date(row.received_at).toLocaleString() : ""}</small>
      </article>)}</div> : <div className={styles.empty}>No matched prospect replies yet. New conversations will appear here automatically.</div>}
    </section>
  </PortalShell>;
}
