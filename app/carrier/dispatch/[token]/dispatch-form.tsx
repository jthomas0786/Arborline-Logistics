"use client";

import { useState } from "react";

export function DispatchForm({ token, initialName = "", initialPhone = "", initialEmail = "", initialTrackingUrl = "" }: { token: string; initialName?: string; initialPhone?: string; initialEmail?: string; initialTrackingUrl?: string }) {
  const [driverName, setDriverName] = useState(initialName);
  const [driverPhone, setDriverPhone] = useState(initialPhone);
  const [driverEmail, setDriverEmail] = useState(initialEmail);
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
        body: JSON.stringify({ driverName, driverPhone, driverEmail })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to assign driver");
      setTrackingUrl(data.trackingUrl);
      setMessage(driverEmail.trim() ? "Driver assigned. Tracking link queued by email." : "Driver assigned. Share the tracking link so the driver can open Arborline and enable notifications.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to assign driver");
    } finally { setBusy(false); }
  }

  return <form className="form offerActions" onSubmit={submit}>
    <label>Driver name<input required maxLength={120} value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver full name" /></label>
    <label>Driver email<input type="email" maxLength={320} value={driverEmail} onChange={(event) => setDriverEmail(event.target.value)} placeholder="driver@example.com" /></label>
    <label>Driver mobile <small className="muted">Optional operational contact only</small><input maxLength={40} value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} placeholder="+1 555 555 5555" /></label>
    <button disabled={busy}>{busy ? "Assigning…" : "Assign driver & start tracking"}</button>
    {message && <div className="offerMessage">{message}</div>}
    {trackingUrl && <a className="button" href={trackingUrl}>Open driver tracking link</a>}
    <p className="carrierFoot">Email is used for the driver's first tracking link. After the driver opens Arborline and enables notifications, ongoing alerts use Web Push. Arborline does not send SMS.</p>
  </form>;
}
