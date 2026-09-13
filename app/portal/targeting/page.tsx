import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import { submitTargetingRequest } from "./actions";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

function tags(items: unknown) {
  return Array.isArray(items) && items.length
    ? <div className={styles.tags}>{items.map((item) => <span className={styles.tag} key={String(item)}>{String(item)}</span>)}</div>
    : <span className={styles.muted}>Not set yet</span>;
}

function statusLabel(value: unknown) {
  return String(value || "SUBMITTED").replaceAll("_", " ");
}

export default async function TargetingPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { client } = await requireConnectClient();
  const params = await searchParams;
  const pool = getPool();
  const [profileResult,rulesResult,requestsResult] = await Promise.all([
    pool.query(`SELECT * FROM connect_icp_profiles WHERE client_id=$1 LIMIT 1`,[client.id]),
    pool.query(`SELECT category,rule_type,label,description,weight FROM connect_qualification_rules WHERE client_id=$1 AND is_active=true ORDER BY sort_order,label`,[client.id]),
    pool.query(`SELECT id,message,status,staff_notes,resolved_at,created_at FROM connect_client_requests WHERE client_id=$1 AND category='TARGETING' ORDER BY created_at DESC LIMIT 8`,[client.id])
  ]);
  const profile = profileResult.rows[0] || {};

  return <PortalShell active="Targeting">
    <header className={styles.header}><div><p className={styles.eyebrow}>YOUR IDEAL CUSTOMER PROFILE</p><h1>Targeting</h1><p className={styles.muted}>Exactly what ArborLine is using to decide which businesses are worth pursuing for {client.company_name}.</p></div><span className={styles.badge}>MIN SCORE {profile.minimum_score ?? 70}</span></header>

    {params.request === "submitted" ? <div className={styles.notice}>Your targeting request was submitted. ArborLine will review it before changing live qualification rules.</div> : null}
    {params.request === "invalid" ? <div className={styles.notice}>Tell us a little more about the change you want to make.</div> : null}

    <section className={styles.grid2}>
      <article className={styles.panel}><h2>Who we are looking for</h2><div className={styles.list}>
        <div className={styles.item}><strong>Industries</strong><p>{tags(profile.target_industries)}</p></div>
        <div className={styles.item}><strong>Geographies</strong><p>{tags(profile.target_geographies)}</p></div>
        <div className={styles.item}><strong>Facility / account types</strong><p>{tags(profile.facility_types)}</p></div>
        <div className={styles.item}><strong>Decision-maker titles</strong><p>{tags(profile.decision_maker_titles)}</p></div>
        <div className={styles.item}><strong>Buying signals</strong><p>{tags(profile.buying_signals)}</p></div>
        <div className={styles.item}><strong>Exclusions</strong><p>{tags(profile.exclusions)}</p></div>
      </div></article>

      <article className={styles.panel}><h2>Qualification standard</h2><div className={styles.list}>
        {rulesResult.rows.map((rule) => <div className={styles.item} key={`${rule.category}-${rule.label}`}><div className={styles.itemTop}><strong>{rule.label}</strong><span className={styles.pill}>{rule.rule_type}</span></div><p>{rule.description || rule.category}</p></div>)}
        {!rulesResult.rows.length ? <div className={styles.empty}>Your qualification rules are still being configured.</div> : null}
      </div></article>
    </section>

    <section className={styles.grid2} style={{marginTop:16}}>
      <article className={styles.panel}>
        <p className={styles.eyebrow}>REQUEST A CHANGE</p>
        <h2>Adjust your targeting</h2>
        <p className={styles.muted}>Tell ArborLine what you want changed. We review requests before applying them so an accidental edit never changes a live campaign.</p>
        <form action={submitTargetingRequest} className={styles.requestForm}>
          <label htmlFor="targeting-message">What should we change?</label>
          <textarea id="targeting-message" name="message" minLength={10} maxLength={4000} required placeholder="Example: Focus more heavily on medical offices with 25+ employees in the western suburbs, and exclude restaurants." />
          <button type="submit" className={styles.button}>Submit targeting request</button>
        </form>
      </article>

      <aside className={styles.panel}>
        <div className={styles.sectionTitle}><h2>Recent requests</h2><span className={styles.muted}>{requestsResult.rows.length}</span></div>
        {requestsResult.rows.length ? <div className={styles.list}>{requestsResult.rows.map((request) => <div className={styles.item} key={request.id}>
          <div className={styles.itemTop}><span className={styles.pill}>{statusLabel(request.status)}</span><small className={styles.muted}>{new Date(request.created_at).toLocaleDateString()}</small></div>
          <p>{request.message}</p>
          {request.staff_notes ? <p><strong>ArborLine:</strong> {request.staff_notes}</p> : null}
        </div>)}</div> : <div className={styles.empty}>No targeting changes requested yet.</div>}
      </aside>
    </section>
  </PortalShell>;
}
