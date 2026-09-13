import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const { client } = await requireConnectClient();
  const { rows } = await getPool().query(`
    SELECT id,status,booking_type,company_name,contact_name,contact_email,summary,
           suggested_next_step,scheduled_for,meeting_url,notes,held_at,closed_at,outcome_notes
    FROM connect_handoffs
    WHERE client_id=$1
    ORDER BY COALESCE(scheduled_for,created_at) DESC
    LIMIT 100
  `,[client.id]);

  return <PortalShell active="Appointments">
    <header className={styles.header}><div><p className={styles.eyebrow}>QUALIFIED HANDOFFS</p><h1>Appointments</h1><p className={styles.muted}>Calls, estimates, demos, and walkthroughs that have reached the handoff stage.</p></div><span className={styles.badge}>{rows.length} HANDOFFS</span></header>
    <section className={styles.panel}>
      {rows.length ? <div className={styles.list}>{rows.map((row) => <article className={styles.item} key={row.id}>
        <div className={styles.itemTop}><div><strong>{row.company_name}</strong><p>{row.contact_name || "Prospect"}{row.contact_email ? ` · ${row.contact_email}` : ""}</p></div><span className={styles.pill}>{row.status}</span></div>
        <div className={styles.tags}><span className={styles.tag}>{row.booking_type}</span>{row.scheduled_for ? <span className={styles.tag}>{new Date(row.scheduled_for).toLocaleString()}</span> : null}</div>
        {row.summary ? <p>{row.summary}</p> : null}
        {row.suggested_next_step ? <p><strong>Next step:</strong> {row.suggested_next_step}</p> : null}
        {row.meeting_url ? <p><a className={styles.button} href={row.meeting_url} target="_blank" rel="noreferrer">Open meeting link</a></p> : null}
      </article>)}</div> : <div className={styles.empty}>No appointments or handoffs yet. Qualified next steps will appear here as they are created.</div>}
    </section>
  </PortalShell>;
}
