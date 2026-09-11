"use client";

import { useState } from "react";

export function DispatchForm({ token, initialName = "", initialPhone = "", initialTrackingUrl = "" }: { token: string; initialName?: string; initialPhone?: string; initialTrackingUrl?: string }) {
  const [driverName, setDriverName] = useState(initialName);
  const [driverPhone, setDriverPhone] = useState(initialPhone);
  const [trackingUrl, setTrackingUrl] = useState(initialTrackingUrl);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/public/dispatch/${token}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driverName, driverPhone })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to assign driver");
      setTrackingUrl(data.trackingUrl);
      setMessage("Driver assigned. Tracking is ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to assign driver");
    } finally { setBusy(false); }
  }

  return <form className="form offerActions" onSubmit={submit}>
    <label>Driver name<input required maxLength={120} value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver full name" /></label>
    <label>Driver mobile<input maxLength={40} value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} placeholder="+1 555 555 5555" /></label>
    <button disabled={busy}>{busy ? "Assigning…" : "Assign driver & start tracking"}</button>
    {message && <div className="offerMessage">{message}</div>}
    {trackingUrl && <a className="button" href={trackingUrl}>Open driver tracking link</a>}
    <p className="carrierFoot">If an outbound SMS provider is configured, Arborline queues the tracking link to the driver automatically. Otherwise, open the link manually for testing.</p>
  </form>;
}
