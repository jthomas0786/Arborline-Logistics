import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Clients"><header><div><p className="eyebrow">CUSTOMER RULES</p><h1>Clients</h1><p className="muted">Each Connect client will define exactly what a valuable opportunity looks like before campaigns begin.</p></div></header><section className="grid stats"><article className="card"><p>Service area</p><h2>Where</h2><small>Markets and travel radius</small></article><article className="card"><p>Ideal account</p><h2>Who</h2><small>Industries, size, facility type</small></article><article className="card"><p>Buying signals</p><h2>Why now</h2><small>Need, timing, vendor review</small></article><article className="card"><p>Handoff</p><h2>Next step</h2><small>Call, demo, estimate, walkthrough</small></article></section><section className="panel"><div className="panelHead"><div><p className="eyebrow">PRINCIPLE</p><h3>Qualification is configurable, not vague</h3></div></div><p className="muted">A cleaning company can require a minimum facility size and service frequency. An MSP can require a minimum employee count. Another service can define a completely different fit profile. Connect should enforce those rules before an appointment is counted.</p></section></AppShell>;
}
