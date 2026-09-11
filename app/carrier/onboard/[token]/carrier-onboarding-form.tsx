"use client";

import { useState, type FormEvent } from "react";
import styles from "./carrier-onboarding-form.module.css";

export function CarrierOnboardingForm({ token, defaultEmail }: { token: string; defaultEmail: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const equipment = form.getAll("equipment").map(String);
    const payload = {
      legalName: String(form.get("legalName") ?? ""), usdotNumber: String(form.get("usdotNumber") ?? ""), mcNumber: String(form.get("mcNumber") ?? ""),
      dispatchPhone: String(form.get("dispatchPhone") ?? ""), dispatchEmail: String(form.get("dispatchEmail") ?? ""), equipment
    };
    try {
      const response = await fetch(`/api/public/carrier-invites/${token}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to submit carrier");
      setSubmitted(true); setMessage("Submitted. Your carrier profile is now pending automated verification. You are not eligible for loads until verification passes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to submit carrier"); }
    finally { setBusy(false); }
  }

  if (submitted) return <div className={`${styles.result} offerMessage`}><strong>Application received</strong><p>{message}</p></div>;

  return <form className={styles.form} onSubmit={submit}><label>Legal company name<input name="legalName" autoComplete="organization" required /></label><div className={styles.twoCol}><label>USDOT number<input name="usdotNumber" inputMode="numeric" required /></label><label>MC number<input name="mcNumber" inputMode="numeric" required /></label></div><div className={styles.twoCol}><label>Dispatch phone<input name="dispatchPhone" type="tel" autoComplete="tel" /></label><label>Dispatch email<input name="dispatchEmail" type="email" defaultValue={defaultEmail} autoComplete="email" /></label></div><fieldset><legend>Equipment</legend><label className={styles.check}><input type="checkbox" name="equipment" value="DRY_VAN" /> 53' Dry Van</label><label className={styles.check}><input type="checkbox" name="equipment" value="REEFER" /> Reefer</label><label className={styles.check}><input type="checkbox" name="equipment" value="FLATBED" /> Flatbed</label></fieldset><button disabled={busy}>{busy ? "Submitting…" : "Submit for verification"}</button>{message && <p className={styles.error}>{message}</p>}<p className="carrierFoot">Submitting this form does not guarantee approval or a freight offer. Carrier authority, insurance, identity, and risk checks must pass before activation.</p></form>;
}
