import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Prospects"><header><div><p className="eyebrow">TARGET ACCOUNTS</p><h1>Prospects</h1><p className="muted">The prospect workspace will hold businesses that match each client’s ideal-customer profile, enrichment, fit score, contact status, and suppression state.</p></div></header><section className="split"><article className="panel"><div className="panelHead"><div><p className="eyebrow">DISCOVERY</p><h3>What gets automated</h3></div></div><div className="health"><div><span>Company discovery</span><b>Planned</b></div><div><span>ICP scoring</span><b>Planned</b></div><div><span>Decision-maker enrichment</span><b>Planned</b></div><div><span>Duplicate and suppression checks</span><b>Required</b></div></div></article><article className="panel"><div className="panelHead"><div><p className="eyebrow">FIRST MARKET</p><h3>Commercial cleaning</h3></div></div><p className="muted">Initial targeting will focus on businesses with recurring facility-cleaning needs such as medical offices, professional buildings, warehouses, gyms, dealerships, and property managers.</p></article></section></AppShell>;
}
