"use client";

import { useState, type FormEvent } from "react";

export function CarrierInviteForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setInviteUrl("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/carrier-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? ""), expiresHours: 72 })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create invite");
      setInviteUrl(data.invite.inviteUrl);
      event.currentTarget.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to create invite");
    } finally { setBusy(false); }
  }

  return <section className="panel"><div className="panelHead"><div><p className="eyebrow">NETWORK GROWTH</p><h3>Invite carrier</h3></div></div><form className="form" onSubmit={submit}><label>Dispatch email<input name="email" type="email" placeholder="dispatch@carrier.com" /></label><button disabled={busy}>{busy ? "Creating…" : "Create 72-hour invite"}</button>{error && <p className="formError">{error}</p>}{inviteUrl && <div className="result"><strong>Invite created</strong><p>Share this opaque onboarding link with the carrier:</p><a href={inviteUrl}>{inviteUrl}</a></div>}</form></section>;
}
