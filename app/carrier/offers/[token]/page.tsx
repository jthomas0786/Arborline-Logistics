import { notFound } from "next/navigation";
import { BrandLogo } from "@/app/components/BrandLogo";
import { PushOptIn } from "@/app/components/PushOptIn";
import { getPool } from "@/lib/db";
import { OfferActions } from "./offer-actions";

async function getOffer(token: string) {
  try {
    const { rows } = await getPool().query(
      `WITH touched AS (
         UPDATE offers
         SET status=CASE
               WHEN status='PENDING' AND (expires_at IS NULL OR expires_at>now()) THEN 'OPENED'::offer_status
               ELSE status
             END,
             opened_at=CASE
               WHEN status IN ('PENDING','OPENED') AND (expires_at IS NULL OR expires_at>now()) THEN COALESCE(opened_at,now())
               ELSE opened_at
             END
         WHERE public_token=$1
         RETURNING *
       )
       SELECT o.id,o.status,o.current_rate,o.maximum_rate,o.expires_at,
              l.reference_number,l.origin_city,l.origin_state,l.destination_city,l.destination_state,
              l.pickup_start,l.equipment_type,l.weight_lbs,l.commodity,
              org.legal_name carrier_name
       FROM touched o
       JOIN loads l ON l.id=o.load_id
       JOIN carriers c ON c.id=o.carrier_id
       JOIN organizations org ON org.id=c.organization_id`,
      [token]
    );
    return rows[0] ?? null;
  } catch { return null; }
}

export default async function CarrierOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const offer = await getOffer(token);
  if (!offer) notFound();
  const expired = Boolean(offer.expires_at) && new Date(offer.expires_at).getTime() < Date.now();
  const actionable = !expired && ["PENDING","OPENED","COUNTERED"].includes(offer.status);
  const accepted = offer.status === "ACCEPTED";

  return <main className="carrierOfferShell"><section className="carrierOfferCard"><BrandLogo context="CARRIER OFFER" className="carrierBrandIdentity"/><p className="eyebrow">{offer.reference_number}</p><h1>{offer.origin_city}, {offer.origin_state} <span className="routeArrow">→</span> {offer.destination_city}, {offer.destination_state}</h1><p className="muted">Offer for {offer.carrier_name}</p><PushOptIn capability={{ kind: "CARRIER_OFFER", token }} /><div className="offerRate"><small>CARRIER RATE</small><strong>${Number(offer.current_rate).toLocaleString(undefined,{minimumFractionDigits:2})}</strong></div><div className="offerFacts"><div><span>Pickup</span><b>{new Date(offer.pickup_start).toLocaleString()}</b></div><div><span>Equipment</span><b>{String(offer.equipment_type).replaceAll("_"," ")}</b></div><div><span>Weight</span><b>{offer.weight_lbs ? `${Number(offer.weight_lbs).toLocaleString()} lb` : "Not specified"}</b></div><div><span>Commodity</span><b>{offer.commodity ?? "General freight"}</b></div><div><span>Offer expires</span><b>{offer.expires_at ? new Date(offer.expires_at).toLocaleString() : "No expiration"}</b></div></div>{actionable ? <OfferActions token={token} currentRate={Number(offer.current_rate)} /> : <div className="offerClosed"><strong>{expired ? "Offer expired" : `Offer ${offer.status.toLowerCase()}`}</strong><p>{accepted ? "This truck is booked. Assign the driver to start shipment tracking." : "This offer can no longer be changed."}</p>{accepted && <a className="button offerNext" href={`/carrier/dispatch/${token}`}>Assign driver & start tracking</a>}</div>}<p className="carrierFoot">By accepting, the carrier confirms the displayed rate and load details. Final booking remains subject to ArborLine&apos;s automated carrier eligibility and risk checks.</p></section></main>;
}
