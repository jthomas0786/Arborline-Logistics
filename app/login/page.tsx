import { login } from "./actions";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid_input: "Enter a valid email and a password of at least 8 characters.",
  invalid_credentials: "The email or password is incorrect.",
  invalid_session: "Your session could not be verified. Please try again.",
  access_required: "Your account is not provisioned for ArborLine yet.",
  auth_not_configured: "Authentication is being configured. Please try again shortly."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const message = params.error ? errors[params.error] ?? "Unable to sign in." : null;

  return <main className={styles.shell}><section className={styles.frame}>
    <aside className={styles.visual} aria-label="ArborLine Logistics automated freight brokerage">
      <img src="/brand/arborline-banner.jpg" alt="ArborLine Logistics — Automated Freight Brokerage" width={900} height={300}/>
      <div className={styles.visualCopy}><span>PEOPLE · TECHNOLOGY · FREIGHT FORWARD</span><strong>A clearer road ahead.</strong></div>
    </aside>
    <section className={styles.card}>
      <div className={styles.brand}><img src="/brand/arborline-logo.png" alt="ArborLine Logistics" width={700} height={227}/><small>SECURE ACCESS</small></div>
      <h1>Sign in</h1><p>Use the ArborLine account assigned to your organization.</p>
      <form className={styles.form} action={login}><input type="hidden" name="next" value={params.next ?? ""}/><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label><button type="submit">Sign in</button></form>
      {message && <p className={styles.error}>{message}</p>}
      <p className={styles.foot}>Access is invitation/provisioning based. Contact ArborLine if your account has not been activated.</p>
    </section>
  </section></main>;
}
