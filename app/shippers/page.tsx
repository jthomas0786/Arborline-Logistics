import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { ShipperAdmin } from "./shipper-admin";

export const dynamic = "force-dynamic";

async function getShippers() {
  const { rows } = await getPool().query(
    `SELECT s.id,o.legal_name,s.onboarding_status,s.credit_status,s.credit_limit,s.payment_terms_days,s.risk_score,s.billing_email,
            COALESCE(ar.open_ar,0) open_ar,COALESCE(freight.uninvoiced_exposure,0) uninvoiced_exposure,
            ov.id override_id,ov.max_exposure override_max_exposure,ov.expires_at override_expires_at
     FROM shippers s
     JOIN organizations o ON o.id=s.organization_id
     LEFT JOIN LATERAL (SELECT COALESCE(sum(amount),0) open_ar FROM shipper_invoices i WHERE i.shipper_id=s.id AND i.status='ISSUED') ar ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(shipper_rate),0) uninvoiced_exposure FROM loads l
       WHERE l.shipper_id=s.id AND l.status IN ('SEARCHING','OFFERING','BOOKED','DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY','DELIVERED','POD_RECEIVED')
     ) freight ON true
     LEFT JOIN LATERAL (
       SELECT id,max_exposure,expires_at FROM shipper_credit_overrides
       WHERE shipper_id=s.id AND revoked_at IS NULL AND expires_at>now()
       ORDER BY max_exposure DESC,created_at DESC LIMIT 1
     ) ov ON true
     ORDER BY o.legal_name`
  );
  return rows;
}

export default async function ShippersPage() {
  await requirePageRole(["STAFF"]);
  const shippers = await getShippers();
  const approved = shippers.filter((row)=>row.credit_status === "APPROVED").length;
  const review = shippers.filter((row)=>row.credit_status === "PENDING").length;
  const exposure = shippers.reduce((sum,row)=>sum+Number(row.open_ar)+Number(row.uninvoiced_exposure),0);
  return <AppShell active="Shippers"><header><div><p className="eyebrow">CUSTOMER RISK</p><h1>Shippers</h1><p className="muted">Onboarding, credit policy, live exposure, payment terms, and audited temporary overrides.</p></div></header><section className="grid stats"><div className="card"><p>Shippers</p><h3>{shippers.length}</h3></div><div className="card"><p>Approved</p><h3>{approved}</h3></div><div className="card"><p>Awaiting review</p><h3>{review}</h3></div><div className="card"><p>Total exposure</p><h3>${exposure.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</h3></div></section><ShipperAdmin shippers={shippers} /></AppShell>;
}
