import { ShipperShell } from "@/app/components/ShipperShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getShipperCreditSnapshot } from "@/lib/shipper-credit";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";

export default async function ShipperAccountPage() {
  const identity = await requirePageRole(["SHIPPER"]);
  let profile = null;
  let credit = null;
  if (identity.shipperId) {
    const { rows } = await getPool().query(
      `SELECT o.legal_name,o.dba_name,s.billing_contact_name,s.billing_email,s.billing_phone,
              s.billing_address_line1,s.billing_address_line2,s.billing_city,s.billing_state,s.billing_postal_code
       FROM shippers s JOIN organizations o ON o.id=s.organization_id WHERE s.id=$1`,
      [identity.shipperId]
    );
    profile = rows[0] ?? null;
    credit = await getShipperCreditSnapshot(identity.shipperId);
  }
  return <ShipperShell active="Account"><header><div><p className="eyebrow">SHIPPER ACCOUNT</p><h1>Company & credit</h1><p className="muted">Maintain the legal billing profile Arborline uses for freight and invoices.</p></div></header><AccountForm profile={profile} credit={credit ? {
    onboardingStatus: credit.onboardingStatus,
    creditStatus: credit.creditStatus,
    creditLimit: credit.creditLimit,
    effectiveLimit: credit.effectiveLimit,
    exposure: credit.exposure,
    paymentTermsDays: credit.paymentTermsDays
  } : null} /></ShipperShell>;
}
