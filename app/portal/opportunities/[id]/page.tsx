import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../../PortalShell";
import styles from "../../portal.module.css";

export const dynamic = "force-dynamic";

function label(value: unknown) {
  return String(value || "").replaceAll("_", " ");
}

function arrayValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client } = await requireConnectClient();
  const pool = getPool();

  const prospectResult = await pool.query(`
    SELECT id,company_name,website,industry,city,state,country,employee_count,location_count,facility_type,
           contact_name,contact_title,contact_email,contact_phone,buying_signals,qualification_score,
           qualification_reasons,outreach_status,created_at,updated_at
    FROM connect_prospects
    WHERE id=$1 AND client_id=$2 AND qualification_status='QUALIFIED'
    LIMIT 1
  `,[id,client.id]);
  const prospect = prospectResult.rows[0];
  if (!prospect) notFound();

  const [messagesResult,repliesResult,handoffsResult] = await Promise.all([
    pool.query(`
      SELECT id,status,subject,sent_at,delivered_at,created_at
      FROM connect_outreach_messages
      WHERE prospect_id=$1 AND client_id=$2 AND status NOT IN ('DRAFT','CANCELLED')
      ORDER BY created_at DESC LIMIT 20
    `,[id,client.id]),
    pool.query(`
      SELECT id,classification,classification_confidence,subject,body_text,received_at
      FROM connect_replies
      WHERE prospect_id=$1 AND client_id=$2 AND match_status='MATCHED'
      ORDER BY received_at DESC LIMIT 20
    `,[id,client.id]),
    pool.query(`
      SELECT id,status,booking_type,summary,suggested_next_step,scheduled_for,meeting_url,notes,held_at,closed_at,outcome_notes,created_at
      FROM connect_handoffs
      WHERE prospect_id=$1 AND client_id=$2
      ORDER BY created_at DESC LIMIT 20
    `,[id,client.id])
  ]);

  const reasons = arrayValues(prospect.qualification_reasons);
  const signals = arrayValues(prospect.buying_signals);
  const latestHandoff = handoffsResult.rows[0];
  const latestReply = repliesResult.rows[0];
  const currentStatus = latestHandoff?.status || (latestReply ? "REPLIED" : prospect.outreach_status);

  const activity = [
    ...messagesResult.rows.map((row) => ({
      type: "OUTREACH",
      when: row.delivered_at || row.sent_at || row.created_at,
      title: row.status === "DELIVERED" ? "Outreach delivered" : `Outreach ${label(row.status).toLowerCase()}`,
      detail: row.subject || "ArborLine outreach"
    })),
    ...repliesResult.rows.map((row) => ({
      type: "REPLY",
      when: row.received_at,
      title: `Reply: ${label(row.classification || "REVIEW")}`,
      detail: row.subject || String(row.body_text || "").slice(0,140)
    })),
    ...handoffsResult.rows.map((row) => ({
      type: "HANDOFF",
      when: row.scheduled_for || row.created_at,
      title: `${label(row.booking_type)} ${label(row.status).toLowerCase()}`,
      detail: row.suggested_next_step || row.summary || "Qualified handoff"
    }))
  ].sort((a,b) => new Date(b.when || 0).getTime() - new Date(a.when || 0).getTime());

  return <PortalShell active="Opportunities">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>OPPORTUNITY DETAIL</p>
        <h1>{prospect.company_name}</h1>
        <p className={styles.muted}>{[prospect.city,prospect.state].filter(Boolean).join(", ") || prospect.country || "Location unavailable"}{prospect.industry ? ` · ${prospect.industry}` : ""}</p>
      </div>
      <div className={styles.headerActions}>
        <span className={styles.scoreBadge}>{prospect.qualification_score ?? "—"}% MATCH</span>
        <span className={styles.badge}>{label(currentStatus)}</span>
      </div>
    </header>

    <div className={styles.backRow}><a className={styles.textLink} href="/portal/opportunities">← Back to opportunities</a></div>

    <section className={styles.detailGrid}>
      <article className={styles.panel}>
        <h2>Why ArborLine qualified this company</h2>
        {reasons.length ? <div className={styles.list}>{reasons.map((reason) => <div className={styles.item} key={reason}><strong>✓ Qualification match</strong><p>{reason}</p></div>)}</div> : <p className={styles.muted}>This company passed your configured qualification standard.</p>}
        {signals.length ? <><h3 className={styles.subheading}>Buying signals</h3><div className={styles.tags}>{signals.map((signal) => <span className={styles.tag} key={signal}>{signal}</span>)}</div></> : null}
      </article>

      <aside className={styles.panel}>
        <h2>Decision maker</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>{prospect.contact_name || "Decision maker identified"}</strong><p>{prospect.contact_title || "Title unavailable"}</p></div>
          <div className={styles.item}><strong>Business email</strong><p>{prospect.contact_email || "Not available"}</p></div>
          {prospect.contact_phone ? <div className={styles.item}><strong>Phone</strong><p>{prospect.contact_phone}</p></div> : null}
        </div>
      </aside>
    </section>

    <section className={styles.detailGrid} style={{marginTop:16}}>
      <article className={styles.panel}>
        <h2>Company snapshot</h2>
        <div className={styles.facts}>
          <div><small>Industry</small><strong>{prospect.industry || "—"}</strong></div>
          <div><small>Employees</small><strong>{prospect.employee_count ?? "—"}</strong></div>
          <div><small>Locations</small><strong>{prospect.location_count ?? "—"}</strong></div>
          <div><small>Account type</small><strong>{prospect.facility_type || "—"}</strong></div>
        </div>
        {prospect.website ? <p style={{marginTop:16}}><a className={styles.secondaryButton} href={prospect.website} target="_blank" rel="noreferrer">Visit company website</a></p> : null}
      </article>

      <aside className={styles.panel}>
        <h2>Current next step</h2>
        {latestHandoff ? <>
          <div className={styles.itemTop}><span className={styles.pill}>{label(latestHandoff.status)}</span><span className={styles.tag}>{label(latestHandoff.booking_type)}</span></div>
          <p>{latestHandoff.suggested_next_step || latestHandoff.summary}</p>
          {latestHandoff.scheduled_for ? <p><strong>Scheduled:</strong> {new Date(latestHandoff.scheduled_for).toLocaleString()}</p> : null}
          {latestHandoff.meeting_url ? <p><a className={styles.button} href={latestHandoff.meeting_url} target="_blank" rel="noreferrer">Open meeting link</a></p> : null}
        </> : latestReply ? <>
          <span className={styles.pill}>{label(latestReply.classification || "REVIEW")}</span>
          <p>ArborLine received a reply and is organizing the appropriate next step.</p>
        </> : <p className={styles.muted}>ArborLine is working this opportunity. The next meaningful response or handoff will appear here.</p>}
      </aside>
    </section>

    <section className={styles.panel} style={{marginTop:16}}>
      <div className={styles.sectionTitle}><h2>Activity</h2><span className={styles.muted}>{activity.length} events</span></div>
      {activity.length ? <div className={styles.timeline}>{activity.map((event,index) => <div className={styles.timelineItem} key={`${event.type}-${index}-${event.when}`}>
        <span className={styles.timelineDot}/>
        <div><div className={styles.itemTop}><strong>{event.title}</strong><small>{event.when ? new Date(event.when).toLocaleString() : ""}</small></div><p>{event.detail}</p></div>
      </div>)}</div> : <div className={styles.empty}>Activity will appear here as ArborLine works this opportunity.</div>}
    </section>
  </PortalShell>;
}
