"use client";

import { useState, type FormEvent } from "react";

type Profile = {
  legal_name?: string | null;
  dba_name?: string | null;
  billing_contact_name?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_postal_code?: string | null;
} | null;

type Credit = {
  onboardingStatus: string;
  creditStatus: string;
  creditLimit: number | null;
  effectiveLimit: number | null;
  exposure: number;
  paymentTermsDays: number;
} | null;

function money(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

export function AccountForm({ profile, credit }: { profile: Profile; credit: Credit }) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/shipper/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to save profile");
      setMessage("Profile saved. Arborline will use these details for billing and credit review.");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save profile");
    } finally { setBusy(false); }
  }

  return <div className="workflowGrid">
    <form className="panel form" onSubmit={save}>
      <div className="panelHead"><div><p className="eyebrow">COMPANY PROFILE</p><h3>Billing identity</h3></div></div>
      <div className="formGrid">
        <label>Legal company name<input name="legalName" defaultValue={profile?.legal_name ?? ""} required /></label>
        <label>DBA name<input name="dbaName" defaultValue={profile?.dba_name ?? ""} /></label>
        <label>Billing contact<input name="billingContactName" defaultValue={profile?.billing_contact_name ?? ""} required /></label>
        <label>Billing email<input name="billingEmail" type="email" defaultValue={profile?.billing_email ?? ""} required /></label>
        <label>Billing phone<input name="billingPhone" defaultValue={profile?.billing_phone ?? ""} /></label>
        <label>Address<input name="billingAddressLine1" defaultValue={profile?.billing_address_line1 ?? ""} required /></label>
        <label>Address line 2<input name="billingAddressLine2" defaultValue={profile?.billing_address_line2 ?? ""} /></label>
        <label>City<input name="billingCity" defaultValue={profile?.billing_city ?? ""} required /></label>
        <label>State<input name="billingState" maxLength={2} defaultValue={profile?.billing_state ?? ""} required /></label>
        <label>Postal code<input name="billingPostalCode" defaultValue={profile?.billing_postal_code ?? ""} required /></label>
      </div>
      <button disabled={busy}>{busy ? "Saving…" : "Save company profile"}</button>
      {message && <div className="offerMessage">{message}</div>}
    </form>

    <aside className="panel quotePanel">
      <p className="eyebrow">CREDIT & TERMS</p>
      {!credit ? <><h3>Credit review pending</h3><p className="muted">Complete your company profile. Arborline staff will review credit before freight can be booked.</p></> : <>
        <div className="quoteBreakdown">
          <div><span>Onboarding</span><b>{credit.onboardingStatus}</b></div>
          <div><span>Credit status</span><b>{credit.creditStatus}</b></div>
          <div><span>Credit limit</span><b>{money(credit.effectiveLimit)}</b></div>
          <div><span>Current exposure</span><b>{money(credit.exposure)}</b></div>
          <div><span>Payment terms</span><b>{credit.paymentTermsDays === 0 ? "Prepay" : `Net ${credit.paymentTermsDays}`}</b></div>
        </div>
        <p className="hint">Credit decisions and temporary overrides are controlled by Arborline staff and are rechecked when a quote is accepted.</p>
      </>}
    </aside>
  </div>;
}
