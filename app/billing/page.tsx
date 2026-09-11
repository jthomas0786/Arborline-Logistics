import { AppShell } from "@/app/components/AppShell";
import { BillingActions } from "./billing-actions";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getBillingRows() {
  const { rows } = await getPool().query(
    `SELECT l.reference_number,l.status,l.closed_at,
            i.id invoice_id,i.invoice_number,i.amount shipper_amount,i.status invoice_status,i.issued_at,i.due_at,i.queued_at,i.sent_at,i.paid_at invoice_paid_at,i.payment_reference invoice_payment_reference,
            p.id payable_id,p.amount carrier_amount,p.status payable_status,p.eligible_at,p.paid_at payable_paid_at,p.hold_reason,p.payment_reference payable_payment_reference,
            org.legal_name carrier_name,s.billing_email,
            (SELECT count(*)::int FROM exceptions e WHERE e.load_id=l.id AND e.status IN ('OPEN','ACKNOWLEDGED')) open_exception_count
     FROM shipper_invoices i
     JOIN loads l ON l.id=i.load_id
     JOIN shippers s ON s.id=i.shipper_id
     LEFT JOIN carrier_payables p ON p.load_id=l.id
     LEFT JOIN carriers c ON c.id=p.carrier_id
     LEFT JOIN organizations org ON org.id=c.organization_id
     ORDER BY i.issued_at DESC
     LIMIT 200`
  );
  return rows;
}

function money(value: unknown) {
  return `$${Number(value ?? 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

export default async function BillingPage() {
  await requirePageRole(["STAFF"]);
  const rows = await getBillingRows();
  const receivables = rows.reduce((sum,row) => sum + (row.invoice_status === "ISSUED" ? Number(row.shipper_amount) : 0), 0);
  const overdue = rows.reduce((sum,row) => sum + (row.invoice_status === "ISSUED" && new Date(row.due_at).getTime() < Date.now() ? Number(row.shipper_amount) : 0), 0);
  const payables = rows.reduce((sum,row) => sum + (["READY","SCHEDULED"].includes(row.payable_status) ? Number(row.carrier_amount) : 0), 0);
  const margin = rows.reduce((sum,row) => sum + Number(row.shipper_amount ?? 0) - Number(row.carrier_amount ?? 0), 0);
  const closed = rows.filter((row) => row.status === "CLOSED").length;

  return <AppShell active="Billing"><header><div><p className="eyebrow">SETTLEMENT</p><h1>Billing & settlement</h1><p className="muted">Shipper receivables, carrier payables, payment holds, aging, and deterministic load closeout. Payment buttons are test-mode only until a real provider is connected.</p></div></header><section className="grid stats"><div className="card"><p>Open shipper A/R</p><h3>{money(receivables)}</h3></div><div className="card"><p>Overdue A/R</p><h3>{money(overdue)}</h3></div><div className="card"><p>Ready carrier A/P</p><h3>{money(payables)}</h3></div><div className="card"><p>Recorded gross margin</p><h3>{money(margin)}</h3></div><div className="card"><p>Closed loads</p><h3>{closed}</h3></div></section><section className="panel"><div className="tableWrap"><table><thead><tr><th>Invoice / load</th><th>Shipper A/R</th><th>Carrier A/P</th><th>Gross margin</th><th>Due / aging</th><th>Exceptions</th><th>Actions</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="empty">No billing records yet.</td></tr> : rows.map((row) => { const gross = Number(row.shipper_amount ?? 0)-Number(row.carrier_amount ?? 0); const ageDays=Math.max(0,Math.floor((Date.now()-new Date(row.issued_at).getTime())/86400000)); return <tr key={row.invoice_number}><td><strong>{row.invoice_number}</strong><br/>{row.reference_number}<br/><span className={`status ${String(row.status).toLowerCase()}`}>{row.status}</span></td><td>{money(row.shipper_amount)}<br/><strong>{row.invoice_status}</strong>{row.invoice_paid_at ? <><br/><small>Paid {new Date(row.invoice_paid_at).toLocaleDateString()}</small></> : null}{row.queued_at ? <><br/><small>Queued {new Date(row.queued_at).toLocaleDateString()}</small></> : null}{row.billing_email ? <><br/><small>{row.billing_email}</small></> : <><br/><small>Billing email missing</small></>}</td><td>{row.carrier_name ?? "—"}<br/>{row.carrier_amount ? money(row.carrier_amount) : "—"}<br/><strong>{row.payable_status ?? "—"}</strong>{row.hold_reason ? <><br/><small>Hold: {row.hold_reason}</small></> : null}</td><td>{money(gross)}</td><td>{new Date(row.due_at).toLocaleDateString()}<br/><small>{ageDays} days since issue</small>{row.invoice_status === "ISSUED" && new Date(row.due_at).getTime() < Date.now() ? <><br/><strong>OVERDUE</strong></> : null}</td><td>{Number(row.open_exception_count) === 0 ? "Clear" : `${row.open_exception_count} open`}</td><td><BillingActions invoiceId={row.invoice_id} invoiceStatus={row.invoice_status} payableId={row.payable_id ?? null} payableStatus={row.payable_status ?? null}/></td></tr>; })}</tbody></table></div></section></AppShell>;
}
