import { AppShell } from "./components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export default async function Home() {
  await requirePageRole(["STAFF"]);
  const snapshot = await getDashboardSnapshot();
  const stats = [
    ["Active loads", String(snapshot.activeLoads), "Current network"],
    ["Moving normally", String(snapshot.movingNormally), "No open exception"],
    ["Need attention", String(snapshot.openExceptions), "Exception queue"],
    ["Gross margin", money.format(snapshot.grossMarginToday), "Booked today"]
  ];

  return (
    <AppShell>
      <header><div><p className="eyebrow">OPERATIONS CONTROL</p><h1>Autopilot Dashboard</h1><p className="muted">Routine freight stays invisible. You work the exceptions.</p></div><a className="button" href="/shipper/new">+ New quote</a></header>
      {!snapshot.databaseOnline && <div className="notice"><strong>Database offline.</strong> Start PostGIS and run the migrations to activate live dashboard data.</div>}
      <section className="grid stats">{stats.map(([label, value, note]) => <article className="card" key={label}><p>{label}</p><h2>{value}</h2><small>{note}</small></article>)}</section>
      <section className="split">
        <article className="panel" id="exceptions"><div className="panelHead"><div><p className="eyebrow">EXCEPTION CENTER</p><h3>Needs attention</h3></div><span className="badge">{snapshot.openExceptions} open</span></div>
          {snapshot.exceptions.length === 0 ? <div className="empty">No open exceptions.</div> : snapshot.exceptions.map((item) => <div className="exception" key={item.id}><div className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</div><div className="grow"><strong>{item.category.replaceAll("_", " ")}</strong><p>{item.reference ?? "System"} · {item.description}</p></div></div>)}
        </article>
        <article className="panel"><div className="panelHead"><div><p className="eyebrow">AUTOMATION</p><h3>Broker health</h3></div><span className="live">LIVE</span></div><div className="health"><div><span>Pricing guardrails</span><b>Operational</b></div><div><span>Carrier matching</span><b>Operational</b></div><div><span>Offer engine</span><b>Operational</b></div><div><span>Atomic booking</span><b>Operational</b></div><div><span>External messaging</span><b>Adapter pending</b></div></div><div className="autopilot"><span>NO-TOUCH BOOKING RATE</span><strong>{snapshot.noTouchRate}%</strong><div className="bar"><i style={{ width: `${Math.min(100, snapshot.noTouchRate)}%` }} /></div><small>Target: 90%</small></div></article>
      </section>
      <section className="panel"><div className="panelHead"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Automation decisions</h3></div></div>
        {snapshot.decisions.length === 0 ? <div className="empty">No automation decisions yet. Create and accept a quote to start the workflow.</div> : snapshot.decisions.map((decision) => <div className="decision" key={decision.id}><span className="time">{time.format(new Date(decision.createdAt))}</span><strong>{decision.reference ?? "System"}</strong><span>{decision.decisionType.replaceAll("_", " ")}</span><em>{String(decision.decision.action ?? "AUTO")}</em></div>)}
      </section>
    </AppShell>
  );
}
