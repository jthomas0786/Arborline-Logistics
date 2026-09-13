import { BrandLogo } from "@/app/components/BrandLogo";
import styles from "../checkout.module.css";

export default function CheckoutCanceledPage() {
  return <main className={styles.page}>
    <div className={styles.wrap}>
      <div className={styles.brand}><BrandLogo context="FOUNDING CLIENT" href="/" /></div>
      <section className={styles.card}>
        <div className={`${styles.status} ${styles.canceled}`}>!</div>
        <p className={styles.eyebrow}>CHECKOUT CANCELED</p>
        <h1 className={styles.title}>No payment was completed.</h1>
        <p className={styles.lead}>Your ArborLine Founding Client checkout was canceled before completion. Nothing has been charged.</p>

        <div className={styles.summary}>
          <div className={styles.summaryItem}><small>Plan</small><strong>Founding Client</strong></div>
          <div className={styles.summaryItem}><small>Price</small><strong>$750 / month</strong></div>
          <div className={styles.summaryItem}><small>Setup</small><strong>$0</strong></div>
        </div>

        <div className={styles.actions}>
          <a className={styles.button} href="/">Return to ArborLine Connect</a>
          <a className={styles.secondary} href="mailto:josh@mail.arborlineconnect.com">Contact ArborLine</a>
        </div>
        <p className={styles.note}>If you meant to complete checkout, reply to your ArborLine email and we can send you a fresh secure checkout link.</p>
      </section>
    </div>
  </main>;
}
