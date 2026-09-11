import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getBillingRows() {
  const { rows } = await getPool().query(
    `SELECT l.reference_number,l.status,
            i.invoice_number,i.amount shipper_amount,i.status invoice_status,i.issued_at,i.due_at,
            p.amount carrier_amount,p.status payable_status,p.eligible_at,
            org.legal_name carrier_name
     FROM shipper_invoices i
     JOIN loads l ON l.id=i.load_id
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
  const payables = rows.reduce((sum,row) => sum + (["READY","SCHEDULED"].includes(row.payable_status) ? Number(row.carrier_amount) : 0), 0);
  const margin = rows.reduce((sum,row) => sum + Number(row.shipper_amount ?? 0) - Number(row.carrier_amount ?? 0), 0);

  return <AppShell active="Billing"><header><div><p className="eyebrow">SETTLEMENT</p><h1>Billing</h1><p className="muted">Shipper receivables, carrier payables, and load-level gross margin.</p></div></header><section className="grid stats"><div className="card"><p>Open shipper A/R</p><h3>{money(receivables)}</h3></div><div className="card"><p>Ready carrier A/P</p><h3>{money(payables)}</h3></div><div className="card"><p>Recorded gross margin</p><h3>{money(margin)}</h3></div><div className="card"><p>Invoices</p><h3>{rows.length}</h3></div></section><section className="panel"><div className="tableWrap"><table><thead><tr><th>Invoice</th><th>Load</th><th>Shipper A/R</th><th>Carrier</th><th>Carrier A/P</th><th>Gross margin</th><th>Due</th><th>Status</th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="empty">No billing records yet.</td></tr> : rows.map((row) => { const gross = Number(row.shipper_amount ?? 0)-Number(row.carrier_amount ?? 0); return <tr key={row.invoice_number}><td><strong>{row.invoice_number}</strong></td><td>{row.reference_number}<br/><span className={`status ${String(row.status).toLowerCase()}`}>{row.status}</span></td><td>{money(row.shipper_amount)}</td><td>{row.carrier_name ?? "—"}</td><td>{row.carrier_amount ? money(row.carrier_amount) : "—"}</td><td>{money(gross)}</td><td>{new Date(row.due_at).toLocaleDateString()}</td><td>{row.invoice_status} / {row.payable_status ?? "—"}</td></tr>; })}</tbody></table></div></section></AppShell>;
}
