"use client";

import { useMemo, useState } from "react";

const nextByStatus: Record<string, { event: string; label: string } | undefined> = {
  DISPATCHED: { event: "AT_PICKUP", label: "Arrived at pickup" },
  AT_PICKUP: { event: "LOADED", label: "Loaded" },
  LOADED: { event: "IN_TRANSIT", label: "Start transit" },
  IN_TRANSIT: { event: "AT_DELIVERY", label: "Arrived at delivery" },
  AT_DELIVERY: { event: "DELIVERED", label: "Delivered" }
};

function currentPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

export function TrackingActions({ token, initialStatus, initialEta = "" }: { token: string; initialStatus: string; initialEta?: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [eta, setEta] = useState(initialEta);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const next = useMemo(() => nextByStatus[status], [status]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch(`/api/public/tracking/${token}/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to record update");
    if (data.status) setStatus(data.status);
    return data;
  }

  async function sendLocation() {
    setBusy(true); setMessage("");
    try {
      const location = await currentPosition();
      if (!location) throw new Error("Location permission is required to send GPS.");
      await post({ eventType: "LOCATION", ...location });
      setMessage("GPS location sent to Arborline.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to send location"); }
    finally { setBusy(false); }
  }

  async function advance() {
    if (!next) return;
    setBusy(true); setMessage("");
    try {
      const location = await currentPosition();
      await post({ eventType: next.event, ...(location ?? {}) });
      setMessage(`${next.label} recorded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update status"); }
    finally { setBusy(false); }
  }

  async function updateEta() {
    setBusy(true); setMessage("");
    try {
      if (!eta) throw new Error("Enter an ETA first.");
      await post({ eventType: "ETA", etaAt: new Date(eta).toISOString() });
      setMessage("ETA updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update ETA"); }
    finally { setBusy(false); }
  }

  return <div className="offerActions">
    <div className="offerRate"><small>CURRENT STATUS</small><strong>{status.replaceAll("_", " ")}</strong></div>
    <button disabled={busy} onClick={sendLocation}>Send current GPS location</button>
    {next && <button disabled={busy} onClick={advance}>{next.label}</button>}
    <div className="counterRow"><span>ETA</span><input aria-label="ETA" type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} /><button className="secondary" disabled={busy} onClick={updateEta}>Update</button></div>
    {message && <div className="offerMessage">{message}</div>}
    <p className="carrierFoot">Location is sent only when you tap a tracking action. Arborline records shipment status and GPS updates on the load timeline.</p>
  </div>;
}
