import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const launchMilestones = [
  ["Public site and Founding Client offer", true],
  ["Client ICP and onboarding foundation", true],
  ["Prospect sourcing and enrichment", true],
  ["Outreach review and approval", true],
  ["Compliance, unsubscribe and suppression controls", true],
  ["Controlled production send pipeline", true],
  ["Stripe billing and webhook lifecycle", true],
  ["Source first live commercial-cleaning prospects", false],
  ["Validate first production outreach send", false],
  ["Validate replies, follow-up and appointment handoff", false],
] as const;

const completedLaunchMilestones = launchMilestones.filter(([, complete]) => complete).length;
const launchProgress = Math.round((completedLaunchMilestones / launchMilestones.length) * 100);
const remainingLaunchMilestones = launchMilestones.filter(([, complete]) => !complete);

const modules = [
  ["Prospect discovery", "BUILT", "Target-account discovery and enrichment are in place around each client’s ideal customer profile."],
  ["Outbound campaigns", "CONTROLLED SEND READY", "Personalized review, approval, suppression, unsubscribe, delivery handling, and controlled sending are built."],
  ["Reply qualification", "FOUNDATION READY", "Reply handling and qualification foundations are in place; production behavior still needs live validation."],
  ["Appointment handoff", "NEXT", "Validate the first live reply and follow-up flow, then complete the qualified appointment handoff."],
] as const;

export default async function OperationsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Dashboard">
    <header><div><p className="eyebrow">ARBORLINE CONNECT</p><h1>Connect Dashboard</h1><p className="muted">Build the smallest repeatable engine that turns target businesses into qualified conversations.</p></div><a className="button" href="/">View public site</a></header>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">LAUNCH READINESS</p><h3>{launchProgress}% complete to launch</h3></div><span className="badge">{completedLaunchMilestones}/{launchMilestones.length} COMPLETE</span></div>
      <div className="autopilot">
        <span>ARBORLINE CONNECT LAUNCH PROGRESS</span>
        <strong>{launchProgress}%</strong>
        <div className="bar"><i style={{ width: `${launchProgress}%` }}/></div>
        <small>{completedLaunchMilestones} of {launchMilestones.length} launch milestones complete. The remaining work is focused on live-market validation, not core platform construction.</small>
      </div>
      <div className="health">
        {remainingLaunchMilestones.map(([name], index) => <div key={name}><span>{name}</span><b>{index === 0 ? "Next" : "Remaining"}</b></div>)}
      </div>
    </section>

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
      <article className="panel"><div className="panelHead"><div><p className="eyebrow">PILOT</p><h3>Current objective</h3></div></div><p className="muted">Source the first live Illinois, Indiana, and Wisconsin commercial-cleaning prospects, validate the first production outreach send, then validate reply qualification, follow-up, and appointment handoff before opening the launch gates.</p><div className="autopilot"><span>NORMAL-CASE AUTOMATION GOAL</span><strong>90%</strong><div className="bar"><i style={{ width: "90%" }}/></div><small>Humans handle unusual replies, disputes, and high-value conversations.</small></div></article>
    </section>
    <section className="panel"><div className="panelHead"><div><p className="eyebrow">LEGACY CODE</p><h3>Freight prototype retained, not marketed</h3></div></div><p className="muted">The previous freight-brokerage workflow remains in the repository during the pivot so useful authentication, communications, audit, and automation infrastructure can be reused. It is no longer part of the ArborLine Connect public positioning.</p></section>
  </AppShell>;
}
