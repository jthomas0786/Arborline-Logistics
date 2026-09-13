import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import { openBillingPortal } from "./actions";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { client } = await requireConnectClient();
  const params = await searchParams;
  const canManage = Boolean(client.billing_status && client.billing_status !== "UNBILLED");

  return <PortalShell active="Billing">
    <header className={styles.header}><div><p className={styles.eyebrow}>ACCOUNT & BILLING</p><h1>Billing</h1><p className={styles.muted}>Your ArborLine Connect subscription and payment status.</p></div><span className={styles.badge}>{client.billing_status || "UNBILLED"}</span></header>

    {params.error ? <div className={styles.notice}>Billing management is not available yet for this account. If that looks wrong, reply to your ArborLine email.</div> : null}

    <section className={styles.grid2}>
      <article className={styles.panel}>
        <p className={styles.eyebrow}>FOUNDING CLIENT</p><h2>$750/month</h2><p className={styles.muted}>$0 setup · Month-to-month · No long-term contract.</p>
        <div className={styles.list}>
          <div className={styles.item}><div className={styles.itemTop}><strong>Subscription status</strong><span className={styles.pill}>{client.billing_status || "UNBILLED"}</span></div></div>
          <div className={styles.item}><strong>Current period ends</strong><p>{client.billing_current_period_end ? new Date(client.billing_current_period_end).toLocaleDateString() : "Not available yet"}</p></div>
          <div className={styles.item}><strong>Last payment</strong><p>{client.billing_last_paid_at ? new Date(client.billing_last_paid_at).toLocaleDateString() : "No paid invoice recorded yet"}</p></div>
        </div>
        {canManage ? <form action={openBillingPortal} style={{marginTop:16}}><button type="submit">Manage billing in Stripe</button></form> : null}
      </article>
      <aside className={styles.panel}><h2>What your plan includes</h2><div className={styles.list}>
        <div className={styles.item}><strong>Target-account discovery</strong><p>Businesses matched to your ideal customer profile.</p></div>
        <div className={styles.item}><strong>Decision-maker research</strong><p>Work contacts identified and verified before outreach.</p></div>
        <div className={styles.item}><strong>Outreach & qualification</strong><p>Relevant conversations organized before handoff.</p></div>
        <div className={styles.item}><strong>Qualified handoffs</strong><p>Calls, estimates, demos, or walkthroughs with context attached.</p></div>
      </div></aside>
    </section>
  </PortalShell>;
}
