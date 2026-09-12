import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Appointments"><header><div><p className="eyebrow">QUALIFIED HANDOFFS</p><h1>Appointments</h1><p className="muted">Only opportunities that pass the client’s qualification rules should land here.</p></div></header><section className="split"><article className="panel"><div className="panelHead"><div><p className="eyebrow">BOOKED</p><h3>Qualification checklist</h3></div></div><div className="health"><div><span>Right geography and company profile</span><b>Required</b></div><div><span>Right decision maker or influencer</span><b>Required</b></div><div><span>Real need or buying timing</span><b>Required</b></div><div><span>Specific agreed date/time or next step</span><b>Required</b></div></div></article><article className="panel"><div className="panelHead"><div><p className="eyebrow">QUALITY CONTROL</p><h3>Booked ≠ held</h3></div></div><p className="muted">Connect will distinguish between a qualified appointment that was booked and one that was actually held. That gives clients a clear quality measure and supports fair credits for obvious no-shows or invalid handoffs.</p></article></section></AppShell>;
}
