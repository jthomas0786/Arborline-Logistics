"use client";

import { useMemo, useState, type FormEvent } from "react";

type ShipperRow = {
  id: string;
  legal_name: string;
  onboarding_status: string;
  credit_status: string;
  credit_limit: string | null;
  payment_terms_days: number;
  risk_score: number;
  billing_email: string | null;
  open_ar: string;
  uninvoiced_exposure: string;
  override_id: string | null;
  override_max_exposure: string | null;
  override_expires_at: string | null;
};

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

export function ShipperAdmin({ shippers }: { shippers: ShipperRow[] }) {
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [selectedId,setSelectedId] = useState(shippers[0]?.id ?? "");
  const selected = useMemo(() => shippers.find((row) => row.id === selectedId) ?? null,[shippers,selectedId]);

  async function submitJson(url: string, method: string, payload: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url,{ method, headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Request failed");
      setMessage("Saved.");
      window.setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally { setBusy(false); }
  }

  function createShipper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    void submitJson("/api/shippers","POST",payload);
  }

  function updateCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = new FormData(event.currentTarget);
    const overrideMax = String(form.get("overrideMaxExposure") ?? "").trim();
    const overrideExpires = String(form.get("overrideExpiresAt") ?? "").trim();
    const overrideReason = String(form.get("overrideReason") ?? "").trim();
    const payload: Record<string, unknown> = {
      creditStatus: form.get("creditStatus"),
      creditLimit: form.get("creditLimit"),
      paymentTermsDays: form.get("paymentTermsDays"),
      riskScore: form.get("riskScore"),
      reason: form.get("reason")
    };
    if (overrideMax || overrideExpires || overrideReason) payload.override = { maxExposure: overrideMax, expiresAt: overrideExpires, reason: overrideReason };
    void submitJson(`/api/shippers/${selectedId}/credit`,"PATCH",payload);
  }

  function revokeOverride() {
    if (!selected?.override_id) return;
    void submitJson(`/api/shippers/${selected.id}/credit`,"PATCH",{
      creditStatus: selected.credit_status,
      creditLimit: selected.credit_limit,
      paymentTermsDays: selected.payment_terms_days,
      riskScore: selected.risk_score,
      reason: "Revoked temporary credit override.",
      revokeOverrideId: selected.override_id
    });
  }

  return <>
    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">CREDIT PORTFOLIO</p><h3>Shippers</h3></div></div>
      <div className="tableWrap"><table><thead><tr><th>Shipper</th><th>Onboarding</th><th>Credit</th><th>Exposure</th><th>Limit</th><th>Available</th><th>Terms</th><th>Override</th></tr></thead><tbody>
        {shippers.length === 0 ? <tr><td colSpan={8} className="empty">No shippers yet.</td></tr> : shippers.map((row) => {
          const exposure=Number(row.open_ar)+Number(row.uninvoiced_exposure); const effective=Math.max(Number(row.credit_limit ?? 0),Number(row.override_max_exposure ?? 0));
          return <tr key={row.id}><td><strong>{row.legal_name}</strong><br/><small>{row.billing_email ?? "No billing email"}</small></td><td>{row.onboarding_status}</td><td>{row.credit_status}</td><td>{money(exposure)}</td><td>{row.credit_limit===null?"—":money(row.credit_limit)}</td><td>{money(Math.max(0,effective-exposure))}</td><td>{row.payment_terms_days===0?"Prepay":`Net ${row.payment_terms_days}`}</td><td>{row.override_id ? <>{money(row.override_max_exposure)}<br/><small>until {new Date(row.override_expires_at!).toLocaleDateString()}</small></> : "—"}</td></tr>;
        })}
      </tbody></table></div>
    </section>

    <div className="workflowGrid">
      <form className="panel form" onSubmit={createShipper}>
        <div className="panelHead"><div><p className="eyebrow">NEW CUSTOMER</p><h3>Create shipper</h3></div></div>
        <div className="formGrid">
          <label>Legal company name<input name="legalName" required /></label>
          <label>DBA name<input name="dbaName" /></label>
          <label>Billing contact<input name="billingContactName" required /></label>
          <label>Billing email<input name="billingEmail" type="email" required /></label>
          <label>Billing phone<input name="billingPhone" /></label>
          <label>Address<input name="billingAddressLine1" required /></label>
          <label>Address line 2<input name="billingAddressLine2" /></label>
          <label>City<input name="billingCity" required /></label>
          <label>State<input name="billingState" maxLength={2} required /></label>
          <label>Postal code<input name="billingPostalCode" required /></label>
        </div>
        <button disabled={busy}>{busy?"Saving…":"Create shipper for review"}</button>
      </form>

      <form className="panel form" onSubmit={updateCredit}>
        <div className="panelHead"><div><p className="eyebrow">CREDIT REVIEW</p><h3>Policy & override</h3></div></div>
        <label>Shipper<select value={selectedId} onChange={(event)=>setSelectedId(event.target.value)} required>{shippers.map((row)=><option key={row.id} value={row.id}>{row.legal_name}</option>)}</select></label>
        <div className="formGrid">
          <label>Status<select name="creditStatus" key={`status-${selectedId}`} defaultValue={selected?.credit_status ?? "PENDING"}><option>PENDING</option><option>APPROVED</option><option>PREPAY</option><option>HOLD</option><option>DECLINED</option></select></label>
          <label>Credit limit<input name="creditLimit" type="number" min="0" step="0.01" key={`limit-${selectedId}`} defaultValue={selected?.credit_limit ?? ""} /></label>
          <label>Payment terms (days)<input name="paymentTermsDays" type="number" min="0" max="120" key={`terms-${selectedId}`} defaultValue={selected?.payment_terms_days ?? 30} /></label>
          <label>Risk score<input name="riskScore" type="number" min="0" max="100" key={`risk-${selectedId}`} defaultValue={selected?.risk_score ?? 0} /></label>
        </div>
        <label>Review reason<input name="reason" placeholder="Why this credit decision is appropriate" required /></label>
        <div className="panelHead"><div><p className="eyebrow">OPTIONAL TEMPORARY OVERRIDE</p></div></div>
        <div className="formGrid">
          <label>Max exposure<input name="overrideMaxExposure" type="number" min="0" step="0.01" /></label>
          <label>Expires<input name="overrideExpiresAt" type="datetime-local" /></label>
          <label>Override reason<input name="overrideReason" /></label>
        </div>
        <button disabled={busy || !selectedId}>{busy?"Saving…":"Save credit review"}</button>
        {selected?.override_id && <button type="button" className="secondary" disabled={busy} onClick={revokeOverride}>Revoke active override</button>}
        {message && <div className="offerMessage">{message}</div>}
      </form>
    </div>
  </>;
}
