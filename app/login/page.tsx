import { login } from "./actions";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid_input: "Enter a valid email and a password of at least 8 characters.",
  invalid_credentials: "The email or password is incorrect.",
  invalid_session: "Your session could not be verified. Please try again.",
  access_required: "Your account is not provisioned for Arborline yet.",
  auth_not_configured: "Authentication is being configured. Please try again shortly."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const message = params.error ? errors[params.error] ?? "Unable to sign in." : null;

  return <main className={styles.shell}><section className={styles.card}><div className={styles.brand}><span className={styles.mark}>A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · SECURE ACCESS</small></div></div><h1>Sign in</h1><p>Use the Arborline account assigned to your organization.</p><form className={styles.form} action={login}><input type="hidden" name="next" value={params.next ?? ""}/><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label><button type="submit">Sign in</button></form>{message && <p className={styles.error}>{message}</p>}<p className={styles.foot}>Access is invitation/provisioning based. Contact Arborline if your account has not been activated.</p></section></main>;
}
