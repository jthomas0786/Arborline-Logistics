import { BrandLogo } from "@/app/components/BrandLogo";
import styles from "../checkout.module.css";

export const dynamic = "force-dynamic";

export default function CheckoutSuccessPage() {
  return <main className={styles.page}>
    <div className={styles.wrap}>
      <div className={styles.brand}><BrandLogo context="FOUNDING CLIENT" href="/" /></div>
      <section className={styles.card}>
        <div className={`${styles.status} ${styles.success}`}>✓</div>
        <p className={styles.eyebrow}>PAYMENT COMPLETE</p>
        <h1 className={styles.title}>Welcome to ArborLine Connect.</h1>
        <p className={styles.lead}>Your Founding Client subscription is active. The last step is a short client setup so ArborLine knows exactly which opportunities to pursue.</p>

        <div className={styles.summary}>
          <div className={styles.summaryItem}><small>Plan</small><strong>Founding Client</strong></div>
          <div className={styles.summaryItem}><small>Price</small><strong>$750 / month</strong></div>
          <div className={styles.summaryItem}><small>Terms</small><strong>$0 setup · Month-to-month</strong></div>
        </div>

        <div className={styles.steps}>
          <div className={styles.step}><span className={styles.number}>1</span><div><strong>Check your email</strong><p>We’re sending secure ArborLine client-portal access to the work email used for your account.</p></div></div>
          <div className={styles.step}><span className={styles.number}>2</span><div><strong>Complete your setup</strong><p>Tell us your U.S. business address, services, service area, ideal customer, decision-maker roles, and exclusions. It takes about five minutes.</p></div></div>
          <div className={styles.step}><span className={styles.number}>3</span><div><strong>ArborLine reviews it</strong><p>Your setup moves to Ready for Review. Outreach does not start until ArborLine checks the profile and activates your campaign.</p></div></div>
        </div>

        <div className={styles.actions}>
          <a className={styles.button} href="/client-access">Open portal & complete setup</a>
          <a className={styles.secondary} href="/">Return to ArborLine Connect</a>
        </div>
        <p className={styles.note}>If the portal email takes a few minutes to arrive, you can still use the client-access page with the email associated with your ArborLine account.</p>
      </section>
    </div>
  </main>;
}
