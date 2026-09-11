"use client";

import { useRef, useState } from "react";

export function PodUpload({ token, initialReceived = false, initialInvoiceNumber = null }: { token: string; initialReceived?: boolean; initialInvoiceNumber?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [received, setReceived] = useState(initialReceived);
  const [invoiceNumber, setInvoiceNumber] = useState(initialInvoiceNumber);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) return setMessage("Choose the signed POD first.");
    setBusy(true); setMessage("");
    try {
      const body = new FormData();
      body.append("pod", file);
      const response = await fetch(`/api/public/tracking/${token}/pod`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to upload POD");
      setReceived(true);
      setInvoiceNumber(data.invoiceNumber ?? null);
      setMessage(data.alreadyReceived ? "POD was already received by Arborline." : "POD validated. Billing records created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload POD");
    } finally {
      setBusy(false);
    }
  }

  if (received) return <div className="offerClosed"><strong>POD received</strong><p>The signed POD passed file validation and Arborline started billing.{invoiceNumber ? ` Reference: ${invoiceNumber}.` : ""}</p>{message && <p>{message}</p>}</div>;

  return <div className="form offerActions">
    <div className="offerRate"><small>PROOF OF DELIVERY</small><strong>Upload signed POD</strong></div>
    <label>Signed POD file<input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" /></label>
    <button disabled={busy} onClick={upload}>{busy ? "Validating POD…" : "Upload POD & start billing"}</button>
    {message && <div className="offerMessage">{message}</div>}
    <p className="carrierFoot">PDF, JPG, or PNG · maximum 4 MB. Arborline validates the file signature before accepting it as POD.</p>
  </div>;
}
