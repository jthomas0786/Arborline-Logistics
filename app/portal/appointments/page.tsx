import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import { updateClientHandoffOutcome } from "./actions";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function selectedOutcome(row: { status?: string | null; client_outcome?: string | null }) {
  if (row.client_outcome) return row.client_outcome;
  if (row.status === "NO_SHOW") return "NO_SHOW";
  if (row.status === "HELD") return "HELD";
  return "";
}

function money(value: unknown) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number);
}

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const { client } = await requireConnectClient();
  const params = await searchParams;
  const { rows } = await getPool().query(`
    SELECT id,prospect_id,status,booking_type,company_name,contact_name,contact_email,summary,
           suggested_next_step,scheduled_for,meeting_url,notes,held_at,closed_at,outcome_notes,
           client_outcome,outcome_updated_at,estimated_monthly_value
    FROM connect_handoffs
    WHERE client_id=$1
    ORDER BY COALESCE(scheduled_for,created_at) DESC
    LIMIT 100
  `,[client.id]);

  return <PortalShell active="Appointments">
    <header className={styles.header}><div><p className={styles.eyebrow}>QUALIFIED HANDOFFS</p><h1>Appointments</h1><p className={styles.muted}>Calls, estimates, demos, and walkthroughs that have reached the handoff stage.</p></div><span className={styles.badge}>{rows.length} HANDOFFS</span></header>
    {params.outcome === "updated" ? <div className={`${styles.notice} ${styles.successNotice}`}><strong>Outcome saved.</strong> ArborLine can now use this result to track what happened after the handoff.</div> : null}
    {params.outcome === "invalid" || params.outcome === "not_found" ? <div className={`${styles.notice} ${styles.errorNotice}`}><strong>Outcome not saved.</strong> Refresh the page and try again.</div> : null}
    {params.outcome === "value_invalid" ? <div className={`${styles.notice} ${styles.errorNotice}`}><strong>Monthly value not saved.</strong> Enter a valid positive dollar amount or leave the field blank.</div> : null}
    <section className={styles.panel}>
      {rows.length ? <div className={styles.list}>{rows.map((row) => <article className={styles.item} key={row.id}>
        <div className={styles.itemTop}><div><strong>{row.company_name}</strong><p>{row.contact_name || "Prospect"}{row.contact_email ? ` · ${row.contact_email}` : ""}</p></div><span className={styles.pill}>{label(row.status)}</span></div>
        <div className={styles.tags}><span className={styles.tag}>{label(row.booking_type)}</span>{row.scheduled_for ? <span className={styles.tag}>{new Date(row.scheduled_for).toLocaleString()}</span> : null}{row.client_outcome ? <span className={styles.tag}>{label(row.client_outcome)}</span> : null}{row.estimated_monthly_value ? <span className={styles.tag}>{money(row.estimated_monthly_value)}/mo</span> : null}</div>
        {row.summary ? <p>{row.summary}</p> : null}
        {row.suggested_next_step ? <p><strong>Next step:</strong> {row.suggested_next_step}</p> : null}
        {row.outcome_notes ? <div className={styles.outcomeSummary}><strong>Outcome note</strong><p>{row.outcome_notes}</p>{row.outcome_updated_at ? <small>Updated {new Date(row.outcome_updated_at).toLocaleString()}</small> : null}</div> : null}
        <div className={styles.itemActions}>
          {row.meeting_url ? <a className={styles.button} href={row.meeting_url} target="_blank" rel="noreferrer">Open meeting link</a> : null}
          <a className={styles.secondaryButton} href={`/portal/opportunities/${row.prospect_id}`}>View opportunity</a>
        </div>
        {row.status !== "DECLINED" ? <form action={updateClientHandoffOutcome} className={styles.outcomeForm}>
          <input type="hidden" name="handoffId" value={row.id}/>
          <input type="hidden" name="returnTo" value="/portal/appointments?outcome=updated"/>
          <div className={styles.outcomeFormHead}><div><strong>What happened?</strong><p>Update ArborLine after the handoff so your pipeline and ROI stay accurate.</p></div></div>
          <div className={styles.outcomeGrid}>
            <label>Outcome<select name="outcome" required defaultValue={selectedOutcome(row)}>
              <option value="" disabled>Select an outcome</option>
              <option value="HELD">Meeting / walkthrough held</option>
              <option value="FOLLOW_UP_NEEDED">Follow-up needed</option>
              <option value="ESTIMATE_SENT">Estimate sent</option>
              <option value="WON">Won</option>
              <option value="LOST">Lost</option>
              <option value="NO_SHOW">No-show</option>
            </select></label>
            <label>Estimated monthly value ($) <span>optional</span><input name="estimatedMonthlyValue" type="number" inputMode="decimal" min="0" step="0.01" max="99999999.99" defaultValue={row.estimated_monthly_value ?? ""} placeholder="2500"/><small>For estimates and wins, use the recurring monthly contract value. ArborLine uses it for revenue ROI reporting.</small></label>
            <label className={styles.fieldWide}>Notes <span>optional</span><textarea name="outcomeNotes" rows={3} maxLength={2000} defaultValue={row.outcome_notes || ""} placeholder="Example: Walkthrough went well. Sent a monthly cleaning estimate and following up Friday."/></label>
          </div>
          <button className={styles.button} type="submit">Save outcome</button>
        </form> : null}
      </article>)}</div> : <div className={styles.empty}>No appointments or handoffs yet. Qualified next steps will appear here as they are created.</div>}
    </section>
  </PortalShell>;
}
