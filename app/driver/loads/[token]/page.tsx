import { notFound } from "next/navigation";
import { PushOptIn } from "@/app/components/PushOptIn";
import { getPool } from "@/lib/db";
import { TrackingActions } from "./tracking-actions";
import { PodUpload } from "./pod-upload";

export const dynamic = "force-dynamic";

async function getTracking(token: string) {
  const { rows } = await getPool().query(
    `SELECT b.tracking_token,b.eta_at,b.last_location_at,
            ST_Y(b.last_location::geometry) last_lat,ST_X(b.last_location::geometry) last_lon,
            l.id load_id,l.reference_number,l.status,l.origin_city,l.origin_state,l.destination_city,l.destination_state,
            l.pickup_start,l.delivery_start,l.equipment_type,l.weight_lbs,l.commodity,
            d.name driver_name,d.phone driver_phone,t.unit_number,org.legal_name carrier_name,
            pod.id pod_id,pod.status pod_status,i.invoice_number
     FROM bookings b
     JOIN loads l ON l.id=b.load_id
     JOIN carriers c ON c.id=b.carrier_id
     JOIN organizations org ON org.id=c.organization_id
     LEFT JOIN drivers d ON d.id=b.driver_id
     LEFT JOIN trucks t ON t.id=b.truck_id
     LEFT JOIN LATERAL (
       SELECT id,status FROM load_documents
       WHERE load_id=l.id AND document_type='POD' AND status='VALIDATED'
       ORDER BY uploaded_at DESC LIMIT 1
     ) pod ON true
     LEFT JOIN shipper_invoices i ON i.load_id=l.id
     WHERE b.tracking_token=$1`,
    [token]
  );
  return rows[0] ?? null;
}

function localEtaValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0,16);
}

export default async function DriverTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tracking = await getTracking(token);
  if (!tracking) notFound();
  const shipmentActive = ["DISPATCHED","AT_PICKUP","LOADED","IN_TRANSIT","AT_DELIVERY"].includes(tracking.status);
  const podEligible = ["DELIVERED","POD_RECEIVED","INVOICED","SETTLED","CLOSED"].includes(tracking.status);
  const pushKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";

  return <main className="carrierOfferShell"><section className="carrierOfferCard driverTrackingCard">
    <div className="carrierBrand"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · DRIVER TRACKING</small></div></div>
    <p className="eyebrow">{tracking.reference_number}</p>
    <h1>{tracking.origin_city}, {tracking.origin_state} <span className="routeArrow">→</span> {tracking.destination_city}, {tracking.destination_state}</h1>
    <p className="muted">{tracking.driver_name ? `${tracking.driver_name} · ` : ""}{tracking.carrier_name}</p>
    <PushOptIn publicKey={pushKey} capability={{ kind: "DRIVER_LOAD", token }} />
    <div className="offerFacts dispatchFacts">
      <div><span>Pickup</span><b>{new Date(tracking.pickup_start).toLocaleString()}</b></div>
      <div><span>Equipment</span><b>{String(tracking.equipment_type).replaceAll("_"," ")}{tracking.unit_number ? ` · ${tracking.unit_number}` : ""}</b></div>
      <div><span>Weight</span><b>{tracking.weight_lbs ? `${Number(tracking.weight_lbs).toLocaleString()} lb` : "Not specified"}</b></div>
      <div><span>Commodity</span><b>{tracking.commodity ?? "General freight"}</b></div>
      <div><span>Last GPS</span><b>{tracking.last_location_at ? new Date(tracking.last_location_at).toLocaleString() : "No location received"}</b></div>
      <div><span>ETA</span><b>{tracking.eta_at ? new Date(tracking.eta_at).toLocaleString() : "Not set"}</b></div>
    </div>
    {!tracking.driver_name ? <div className="offerClosed"><strong>Waiting for driver assignment</strong><p>The carrier must assign a driver before tracking can begin.</p></div> : shipmentActive ? <TrackingActions token={token} initialStatus={tracking.status} initialEta={localEtaValue(tracking.eta_at)} /> : <div className="offerClosed"><strong>{String(tracking.status).replaceAll("_"," ")}</strong><p>Shipment movement is complete. Submit the signed proof of delivery below.</p></div>}
    {podEligible && <PodUpload token={token} initialReceived={Boolean(tracking.pod_id)} initialInvoiceNumber={tracking.invoice_number ?? null} />}
  </section></main>;
}
