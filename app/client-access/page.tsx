import { BrandLogo } from "../components/BrandLogo";
import { requestClientAccess } from "./actions";
import styles from "../login/login.module.css";

export const dynamic = "force-dynamic";

export default async function ClientAccessPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = params.error;

  return <main className={styles.shell}><section className={styles.frame}>
    <aside className={styles.visual} aria-label="ArborLine Connect client portal">
      <div className={styles.visualBrand}><img src="/brand/arborline-badge.png" alt="" width={92} height={92}/><p>CLIENT PORTAL</p><h2>Your pipeline.<br/>Without the busywork.</h2></div>
      <div className={styles.flow}>
        <div><small>FIND</small><strong>01</strong><span>Matching businesses</span></div><i>→</i>
        <div className={styles.flowCenter}><small>QUALIFY</small><strong>02</strong><span>Real opportunities</span></div><i>→</i>
        <div><small>HANDOFF</small><strong>03</strong><span>Next steps</span></div>
      </div>
      <p className={styles.visualFoot}>See qualified opportunities, conversations, appointments, targeting, and billing in one place.</p>
    </aside>
    <section className={styles.card}>
      <BrandLogo context="CLIENT ACCESS"/>
      <h1>Access your ArborLine portal</h1>
      <p>Enter the work email ArborLine invited. We’ll send a secure sign-in link—no password required.</p>
      {sent ? <p className={styles.error} style={{color:"#5fd5a2"}}>If that email has an active ArborLine invitation, a secure sign-in link is on the way.</p> : null}
      {error ? <p className={styles.error}>{error === "invalid" ? "Enter a valid work email." : "We couldn’t send the access link. Please try again."}</p> : null}
      <form className={styles.form} action={requestClientAccess}>
        <label>Work email<input name="email" type="email" autoComplete="email" required /></label>
        <button type="submit">Email me a secure link</button>
      </form>
      <p className={styles.foot}>Need access? Reply to your ArborLine email and we’ll help. <a href="/">Return to ArborLine Connect</a>.</p>
    </section>
  </section></main>;
}
