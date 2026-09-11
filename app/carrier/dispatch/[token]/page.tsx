import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { DispatchForm } from "./dispatch-form";

export const dynamic = "force-dynamic";

async function getBooking(token: string) {
  const { rows } = await getPool().query(
    `SELECT o.public_token,o.status offer_status,l.reference_number,l.origin_city,l.origin_state,
            l.destination_city,l.destination_state,l.pickup_start,l.equipment_type,l.status load_status,
            org.legal_name carrier_name,b.tracking_token,d.name driver_name,d.phone driver_phone
     FROM offers o
     JOIN loads l ON l.id=o.load_id
     JOIN bookings b ON b.load_id=o.load_id AND b.carrier_id=o.carrier_id
     JOIN carriers c ON c.id=o.carrier_id
     JOIN organizations org ON org.id=c.organization_id
     LEFT JOIN drivers d ON d.id=b.driver_id
     WHERE o.public_token=$1 AND o.status='ACCEPTED'`,
    [token]
  );
  return rows[0] ?? null;
}

export default async function CarrierDispatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getBooking(token);
  if (!booking) notFound();
  const trackingUrl = booking.driver_name ? `/driver/loads/${booking.tracking_token}` : "";

  return <main className="carrierOfferShell"><section className="carrierOfferCard">
    <div className="carrierBrand"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · DISPATCH</small></div></div>
    <p className="eyebrow">{booking.reference_number}</p>
    <h1>Assign the driver</h1>
    <p className="muted">{booking.origin_city}, {booking.origin_state} <span className="routeArrow">→</span> {booking.destination_city}, {booking.destination_state}</p>
    <div className="offerFacts dispatchFacts"><div><span>Carrier</span><b>{booking.carrier_name}</b></div><div><span>Pickup</span><b>{new Date(booking.pickup_start).toLocaleString()}</b></div><div><span>Equipment</span><b>{String(booking.equipment_type).replaceAll("_"," ")}</b></div><div><span>Load status</span><b>{String(booking.load_status).replaceAll("_"," ")}</b></div></div>
    <DispatchForm token={token} initialName={booking.driver_name ?? ""} initialPhone={booking.driver_phone ?? ""} initialTrackingUrl={trackingUrl} />
  </section></main>;
}
