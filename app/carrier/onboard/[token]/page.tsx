import { notFound } from "next/navigation";
import { getPool } from "@/lib/db";
import { CarrierOnboardingForm } from "./carrier-onboarding-form";

async function getInvite(token: string) {
  try {
    const { rows } = await getPool().query(`SELECT status,contact_email,expires_at FROM carrier_invites WHERE public_token=$1`, [token]);
    return rows[0] ?? null;
  } catch { return null; }
}

export default async function CarrierOnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);
  if (!invite) notFound();
  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  const available = invite.status === "PENDING" && !expired;

  return <main className="carrierOfferShell"><section className="carrierOfferCard onboardingCard"><div className="carrierBrand"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · CARRIER ONBOARDING</small></div></div><p className="eyebrow">CARRIER NETWORK</p><h1>Join Arborline</h1><p className="muted">Submit your operating information. Arborline will not send freight until authority, insurance, and company identity have passed verification.</p>{available ? <CarrierOnboardingForm token={token} defaultEmail={invite.contact_email ?? ""} /> : <div className="offerClosed"><strong>{expired ? "Invite expired" : `Invite ${String(invite.status).toLowerCase()}`}</strong><p>Ask Arborline for a new carrier invitation if needed.</p></div>}</section></main>;
}
