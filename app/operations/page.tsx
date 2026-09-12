import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const modules = [
  ["Prospect discovery", "NEXT", "Build target-account discovery and enrichment around each client’s ideal customer profile."],
  ["Outbound campaigns", "RESEND SETUP", "Connect the verified sending domain, then run personalized sequences with suppression and opt-out controls."],
  ["Reply qualification", "NEXT", "Classify interest, objections, wrong contacts, and opt-outs before anything reaches a client."],
  ["Appointment handoff", "NEXT", "Qualify against client rules, collect context, and schedule the next conversation."],
] as const;

export default async function OperationsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Dashboard">
    <header><div><p className="eyebrow">ARBORLINE CONNECT</p><h1>Connect Dashboard</h1><p className="muted">Build the smallest repeatable engine that turns target businesses into qualified conversations.</p></div><a className="button" href="/">View public site</a></header>
    <section className="grid stats">
      <article className="card"><p>Launch market</p><h2>Commercial cleaning</h2><small>First validation niche</small></article>
      <article className="card"><p>Core offer</p><h2>Qualified appointments</h2><small>Not raw contact lists</small></article>
      <article className="card"><p>Automation target</p><h2>85–95%</h2><small>Normal workflow after validation</small></article>
      <article className="card"><p>Business model</p><h2>Recurring B2B</h2><small>Expand after proof</small></article>
    </section>
    <section className="panel"><div className="panelHead"><div><p className="eyebrow">BUILD SEQUENCE</p><h3>Connect automation pipeline</h3></div><span className="badge">PIVOT ACTIVE</span></div>
      {modules.map(([name,status,description]) => <div className="decision" key={name}><strong>{name}</strong><span>{description}</span><em>{status}</em></div>)}
    </section>
    <section className="split">
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">QUALIFICATION STANDARD</p><h3>What reaches the client</h3></div></div><div className="health"><div><span>Matches service area and ICP</span><b>Required</b></div><div><span>Relevant decision maker/influencer</span><b>Required</b></div><div><span>Legitimate need or buying timing</span><b>Required</b></div><div><span>Specific agreed next step</span><b>Required</b></div></div></article>
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">PILOT</p><h3>Current objective</h3></div></div><p className="muted">Get the public Connect site collecting founding-pilot interest, connect Resend, then build the first client campaign end-to-end before adding additional verticals.</p><div className="autopilot"><span>NORMAL-CASE AUTOMATION GOAL</span><strong>90%</strong><div className="bar"><i style={{ width: "90%" }}/></div><small>Humans handle unusual replies, disputes, and high-value conversations.</small></div></article>
    </section>
    <section className="panel"><div className="panelHead"><div><p className="eyebrow">LEGACY CODE</p><h3>Freight prototype retained, not marketed</h3></div></div><p className="muted">The previous freight-brokerage workflow remains in the repository during the pivot so useful authentication, communications, audit, and automation infrastructure can be reused. It is no longer part of the ArborLine Connect public positioning.</p></section>
  </AppShell>;
}
