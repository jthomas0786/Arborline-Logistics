import { AppShell } from "@/app/components/AppShell";
import { ShipperShell } from "@/app/components/ShipperShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { canCreateQuote, getShipperCreditSnapshot } from "@/lib/shipper-credit";
import { QuoteForm } from "./quote-form";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const identity = await requirePageRole(["STAFF", "SHIPPER"]);
  if (identity.role === "STAFF") {
    const { rows } = await getPool().query(
      `SELECT s.id,o.legal_name,s.onboarding_status,s.credit_status
       FROM shippers s JOIN organizations o ON o.id=s.organization_id
       WHERE o.status='ACTIVE' ORDER BY o.legal_name`
    );
    const content = <><header><div><p className="eyebrow">SHIPPER INTAKE</p><h1>Create a shipment quote</h1><p className="muted">Select the customer, price the load, and book only after Arborline rechecks credit exposure.</p></div></header><QuoteForm shipperOptions={rows.map((row)=>({ id:row.id, legalName:row.legal_name, onboardingStatus:row.onboarding_status, creditStatus:row.credit_status }))} /></>;
    return <AppShell active="New quote">{content}</AppShell>;
  }

  const credit = identity.shipperId ? await getShipperCreditSnapshot(identity.shipperId) : null;
  const decision = credit ? canCreateQuote(credit) : { allowed:false, reason:"Complete your company profile before requesting a quote." };
  if (!decision.allowed) {
    return <ShipperShell active="New quote"><header><div><p className="eyebrow">SHIPPER INTAKE</p><h1>Quote access</h1><p className="muted">Arborline checks onboarding and credit status before extending transportation credit.</p></div></header><section className="panel"><h3>{credit?.creditStatus === "PENDING" ? "Credit review pending" : "Account action required"}</h3><p>{decision.reason}</p>{credit && <div className="quoteBreakdown"><div><span>Onboarding</span><b>{credit.onboardingStatus}</b></div><div><span>Credit status</span><b>{credit.creditStatus}</b></div><div><span>Current exposure</span><b>${credit.exposure.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></div></div>}<a className="button" href="/shipper/account">Open company & credit profile</a></section></ShipperShell>;
  }

  const content = <><header><div><p className="eyebrow">SHIPPER INTAKE</p><h1>Create a shipment quote</h1><p className="muted">Price the load, accept the quote, and book transportation in one flow.</p></div></header><QuoteForm /></>;
  return <ShipperShell active="New quote">{content}</ShipperShell>;
}
