"use client";

import { useState, type FormEvent } from "react";

type QuoteRecord = {
  id: string;
  reference_number: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  expected_carrier_cost: string;
  shipper_price: string;
  target_carrier_rate: string;
  max_carrier_rate: string;
  pricing_notes: string[];
};

type Accepted = { load: { id: string; reference_number: string }; autopilot: { status: string; searchRadiusMiles?: number; eligibleMatches?: number; offersCreated?: number; reason?: string } };

export function QuoteForm() {
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setQuote(null); setAccepted(null);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const numeric = ["estimatedMiles", "weightLbs", "cargoValue"];
    for (const key of numeric) payload[key] = Number(payload[key]);
    try {
      const response = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create quote");
      setQuote(data.quote);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to create quote"); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!quote) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}/accept`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to accept quote");
      setAccepted(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to accept quote"); }
    finally { setBusy(false); }
  }

  return <div className="workflowGrid"><form className="panel form" onSubmit={submit}><div className="panelHead"><div><p className="eyebrow">LOAD DETAILS</p><h3>Shipment</h3></div></div><div className="formGrid">
    <label>Origin city<input name="originCity" defaultValue="Chicago" required /></label><label>Origin state<input name="originState" defaultValue="IL" maxLength={2} required /></label>
    <label>Destination city<input name="destinationCity" defaultValue="Dallas" required /></label><label>Destination state<input name="destinationState" defaultValue="TX" maxLength={2} required /></label>
    <label>Pickup<input name="pickupStart" type="datetime-local" required /></label><label>Equipment<select name="equipmentType" defaultValue="DRY_VAN"><option value="DRY_VAN">53' Dry Van</option><option value="REEFER">Reefer</option><option value="FLATBED">Flatbed</option></select></label>
    <label>Estimated miles<input name="estimatedMiles" type="number" min="1" defaultValue="925" required /></label><label>Weight (lb)<input name="weightLbs" type="number" min="0" defaultValue="38000" /></label>
    <label>Commodity<input name="commodity" defaultValue="Packaged food" /></label><label>Cargo value<input name="cargoValue" type="number" min="0" defaultValue="32000" /></label>
  </div><button disabled={busy}>{busy ? "Working…" : "Calculate quote"}</button>{error && <p className="formError">{error}</p>}<p className="hint">Demo geocoding recognizes major freight hubs. Unknown cities are quoted normally but carrier search pauses safely for geocoding.</p></form>
  <aside className="panel quotePanel"><p className="eyebrow">AUTOPILOT QUOTE</p>{!quote ? <div className="empty tall">Enter a shipment to see the automated quote and carrier guardrails.</div> : <><h3>{quote.reference_number}</h3><p className="route">{quote.origin_city}, {quote.origin_state} <span>→</span> {quote.destination_city}, {quote.destination_state}</p><div className="quotePrice"><small>SHIPPER PRICE</small><strong>${Number(quote.shipper_price).toLocaleString(undefined,{minimumFractionDigits:2})}</strong></div><div className="quoteBreakdown"><div><span>Target carrier</span><b>${Number(quote.target_carrier_rate).toLocaleString()}</b></div><div><span>Auto-book ceiling</span><b>${Number(quote.max_carrier_rate).toLocaleString()}</b></div><div><span>Expected carrier cost</span><b>${Number(quote.expected_carrier_cost).toLocaleString()}</b></div></div>{quote.pricing_notes?.map((note) => <p className="hint" key={note}>• {note}</p>)}<button onClick={accept} disabled={busy || Boolean(accepted)}>{accepted ? "Accepted" : "Accept & find truck"}</button>{accepted && <div className={`result ${accepted.autopilot.status.toLowerCase()}`}><strong>{accepted.load.reference_number} · {accepted.autopilot.status}</strong><p>{accepted.autopilot.status === "OFFERING" ? `${accepted.autopilot.offersCreated} offers sent from ${accepted.autopilot.eligibleMatches} eligible matches within ${accepted.autopilot.searchRadiusMiles} miles.` : `Autopilot paused: ${accepted.autopilot.reason ?? "review required"}.`}</p><a href="/loads">View loads →</a></div>}</>}</aside></div>;
}
