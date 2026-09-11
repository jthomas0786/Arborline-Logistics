"use client";

import { useEffect, useState, type FormEvent } from "react";

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
type RouteCoordinates = { origin: { lat: number; lon: number }; destination: { lat: number; lon: number } };
type RouteStatus = "idle" | "calculating" | "ready" | "fallback" | "error";

export function QuoteForm() {
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [originCity, setOriginCity] = useState("Chicago");
  const [originState, setOriginState] = useState("IL");
  const [destinationCity, setDestinationCity] = useState("Dallas");
  const [destinationState, setDestinationState] = useState("TX");
  const [estimatedMiles, setEstimatedMiles] = useState("");
  const [routeStatus, setRouteStatus] = useState<RouteStatus>("idle");
  const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinates | null>(null);

  useEffect(() => {
    const locationReady = originCity.trim().length >= 2 && originState.trim().length === 2 && destinationCity.trim().length >= 2 && destinationState.trim().length === 2;
    if (!locationReady) {
      setRouteStatus("idle");
      setRouteCoordinates(null);
      return;
    }

    const controller = new AbortController();
    setRouteStatus("calculating");
    setRouteCoordinates(null);
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ originCity, originState, destinationCity, destinationState });
        const response = await fetch(`/api/routing/estimate?${query.toString()}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to estimate route miles");
        setEstimatedMiles(String(data.miles));
        setRouteCoordinates({ origin: data.origin, destination: data.destination });
        setRouteStatus(data.source === "ROAD_ROUTE" ? "ready" : "fallback");
      } catch (err) {
        if (controller.signal.aborted) return;
        setRouteStatus("error");
        setRouteCoordinates(null);
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [originCity, originState, destinationCity, destinationState]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setQuote(null); setAccepted(null);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) payload[key] = String(value);
    for (const key of ["estimatedMiles", "weightLbs", "cargoValue", "originLat", "originLon", "destinationLat", "destinationLon"]) {
      if (payload[key] !== undefined && payload[key] !== "") payload[key] = Number(payload[key]);
    }
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
    <label>Origin city<input name="originCity" value={originCity} onChange={(event) => setOriginCity(event.target.value)} required /></label><label>Origin state<input name="originState" value={originState} onChange={(event) => setOriginState(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} required /></label>
    <label>Destination city<input name="destinationCity" value={destinationCity} onChange={(event) => setDestinationCity(event.target.value)} required /></label><label>Destination state<input name="destinationState" value={destinationState} onChange={(event) => setDestinationState(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} required /></label>
    <label>Pickup<input name="pickupStart" type="datetime-local" required /></label><label>Equipment<select name="equipmentType" defaultValue="DRY_VAN"><option value="DRY_VAN">53' Dry Van</option><option value="REEFER">Reefer</option><option value="FLATBED">Flatbed</option></select></label>
    <label>Estimated miles<input name="estimatedMiles" type="number" min="1" value={estimatedMiles} onChange={(event) => setEstimatedMiles(event.target.value)} placeholder={routeStatus === "calculating" ? "Calculating…" : "Auto-calculated"} required /></label><label>Weight (lb)<input name="weightLbs" type="number" min="0" defaultValue="38000" /></label>
    <label>Commodity<input name="commodity" defaultValue="Packaged food" /></label><label>Cargo value<input name="cargoValue" type="number" min="0" defaultValue="32000" /></label>
  </div>{routeCoordinates && <><input type="hidden" name="originLat" value={routeCoordinates.origin.lat} /><input type="hidden" name="originLon" value={routeCoordinates.origin.lon} /><input type="hidden" name="destinationLat" value={routeCoordinates.destination.lat} /><input type="hidden" name="destinationLon" value={routeCoordinates.destination.lon} /></>}
  {routeStatus === "calculating" && <p className="hint">Calculating road miles from origin to destination…</p>}{routeStatus === "ready" && <p className="hint">Estimated miles calculated automatically from the road route.</p>}{routeStatus === "fallback" && <p className="hint">Road routing is temporarily unavailable; using a geographic mileage estimate. You can adjust it manually.</p>}{routeStatus === "error" && <p className="hint">Mileage could not be calculated automatically. Enter estimated miles manually to continue.</p>}
  <button disabled={busy || routeStatus === "calculating"}>{busy ? "Working…" : "Calculate quote"}</button>{error && <p className="formError">{error}</p>}<p className="hint">Location coordinates from the mileage estimate are also used to launch carrier search after quote acceptance.</p></form>
  <aside className="panel quotePanel"><p className="eyebrow">AUTOPILOT QUOTE</p>{!quote ? <div className="empty tall">Enter a shipment to see the automated quote and carrier guardrails.</div> : <><h3>{quote.reference_number}</h3><p className="route">{quote.origin_city}, {quote.origin_state} <span>→</span> {quote.destination_city}, {quote.destination_state}</p><div className="quotePrice"><small>SHIPPER PRICE</small><strong>${Number(quote.shipper_price).toLocaleString(undefined,{minimumFractionDigits:2})}</strong></div><div className="quoteBreakdown"><div><span>Target carrier</span><b>${Number(quote.target_carrier_rate).toLocaleString()}</b></div><div><span>Auto-book ceiling</span><b>${Number(quote.max_carrier_rate).toLocaleString()}</b></div><div><span>Expected carrier cost</span><b>${Number(quote.expected_carrier_cost).toLocaleString()}</b></div></div>{quote.pricing_notes?.map((note) => <p className="hint" key={note}>• {note}</p>)}<button onClick={accept} disabled={busy || Boolean(accepted)}>{accepted ? "Accepted" : "Accept & find truck"}</button>{accepted && <div className={`result ${accepted.autopilot.status.toLowerCase()}`}><strong>{accepted.load.reference_number} · {accepted.autopilot.status}</strong><p>{accepted.autopilot.status === "OFFERING" ? `${accepted.autopilot.offersCreated} offers queued from ${accepted.autopilot.eligibleMatches} eligible matches within ${accepted.autopilot.searchRadiusMiles} miles.` : `Autopilot paused: ${accepted.autopilot.reason ?? "review required"}.`}</p><a href="/loads">View loads →</a></div>}</>}</aside></div>;
}
