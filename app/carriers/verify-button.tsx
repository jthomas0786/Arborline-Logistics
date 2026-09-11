"use client";

import { useState } from "react";

export function VerifyCarrierButton({ carrierId, disabled = false }: { carrierId: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function verify() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/carriers/${carrierId}/verify`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to verify carrier");
      const carrier = data.carrier;
      setMessage(carrier?.onboarding_status === "VERIFIED" ? "Verified" : carrier?.compliance_hold_reason || carrier?.verification_status || "Verification complete");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify carrier");
    } finally {
      setBusy(false);
    }
  }

  return <div><button type="button" className="secondary" disabled={busy || disabled} onClick={verify}>{busy ? "Checking…" : "Reverify"}</button>{message && <small className="muted" style={{display:"block",marginTop:4}}>{message}</small>}</div>;
}
