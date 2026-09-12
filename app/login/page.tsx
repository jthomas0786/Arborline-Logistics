import { BrandLogo } from "../components/BrandLogo";
import { login } from "./actions";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid_input: "Enter a valid email and a password of at least 8 characters.",
  invalid_credentials: "The email or password is incorrect.",
  invalid_session: "Your session could not be verified. Please try again.",
  access_required: "Your account is not provisioned for ArborLine Connect yet.",
  auth_not_configured: "Authentication is being configured. Please try again shortly."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const message = params.error ? errors[params.error] ?? "Unable to sign in." : null;

  return <main className={styles.shell}><section className={styles.frame}>
    <aside className={styles.visual} aria-label="ArborLine Connect automated business development">
      <div className={styles.visualBrand}><img src="/brand/arborline-badge.png" alt="" width={92} height={92}/><p>AUTOMATED B2B CONNECTIONS</p><h2>Find the right business.<br/>Start the right conversation.</h2></div>
      <div className={styles.flow}>
        <div><small>TARGET</small><strong>A</strong><span>Your ideal customer profile</span></div>
        <i>→</i>
        <div className={styles.flowCenter}><small>CONNECT</small><strong>↗</strong><span>Discover · qualify · schedule</span></div>
        <i>→</i>
        <div><small>OPPORTUNITY</small><strong>B</strong><span>Qualified appointment</span></div>
      </div>
      <p className={styles.visualFoot}>Prospecting, follow-up, qualification, and appointment handoff—built to run with minimal manual work.</p>
    </aside>
    <section className={styles.card}>
      <BrandLogo context="SECURE ACCESS"/>
      <h1>Sign in</h1><p>Manage ArborLine Connect prospects, campaigns, client rules, and qualified appointments.</p>
      <form className={styles.form} action={login}><input type="hidden" name="next" value={params.next ?? ""}/><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label><button type="submit">Sign in</button></form>
      {message && <p className={styles.error}>{message}</p>}
      <p className={styles.foot}>Access is invitation/provisioning based during the pilot. <a href="/">Return to ArborLine Connect</a>.</p>
    </section>
  </section></main>;
}
