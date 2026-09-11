"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BillingActions({
  invoiceId,
  invoiceStatus,
  payableId,
  payableStatus
}: {
  invoiceId: string;
  invoiceStatus: string;
  payableId: string | null;
  payableStatus: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function post(url: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to update billing.");
      setMessage(label === "invoice" ? "Invoice queued." : label === "shipper" ? "Test shipper payment recorded." : label === "carrier" ? "Test carrier payment recorded." : "Updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update billing.");
    } finally {
      setBusy(null);
    }
  }

  function hold() {
    if (!payableId) return;
    const reason = window.prompt("Reason for carrier payment hold:", "Staff review required");
    if (reason === null) return;
    void post(`/api/billing/payables/${payableId}`, { action: "HOLD", reason }, "hold");
  }

  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 250 }}>
    <a className="buttonSecondary" href={`/api/billing/invoices/${invoiceId}/pdf`} target="_blank" rel="noreferrer">Invoice PDF</a>
    {invoiceStatus !== "PAID" && invoiceStatus !== "VOID" && <>
      <button disabled={busy !== null} onClick={() => post(`/api/billing/invoices/${invoiceId}`, { action: "QUEUE" }, "invoice")}>{busy === "invoice" ? "Queuing…" : "Queue invoice"}</button>
      <button disabled={busy !== null} onClick={() => post(`/api/billing/invoices/${invoiceId}`, { action: "MARK_PAID", isTest: true, method: "TEST_ACH" }, "shipper")}>{busy === "shipper" ? "Recording…" : "Record test shipper payment"}</button>
    </>}
    {payableId && payableStatus === "HOLD" && <button disabled={busy !== null} onClick={() => post(`/api/billing/payables/${payableId}`, { action: "RELEASE" }, "release")}>Release carrier hold</button>}
    {payableId && payableStatus && !["PAID","VOID","HOLD"].includes(payableStatus) && <>
      <button disabled={busy !== null} onClick={hold}>Hold carrier pay</button>
      <button disabled={busy !== null} onClick={() => post(`/api/billing/payables/${payableId}`, { action: "MARK_PAID", isTest: true, method: "TEST_ACH" }, "carrier")}>{busy === "carrier" ? "Recording…" : "Record test carrier payment"}</button>
    </>}
    {message && <small style={{ width: "100%" }}>{message}</small>}
  </div>;
}
