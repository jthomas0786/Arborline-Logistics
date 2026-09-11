const stats = [
  ["Active loads", "47", "+8 today"],
  ["Moving normally", "43", "91.5% no-touch"],
  ["Need attention", "4", "Exception queue"],
  ["Gross margin", "$8,420", "Today"],
];

const exceptions = [
  { severity: "High", load: "AL-10463", title: "Driver may miss pickup", detail: "Pickup in 2h 14m · shadow capacity search started" },
  { severity: "Review", load: "AL-10458", title: "Carrier counter exceeds auto ceiling", detail: "$180 over autonomous rate limit" },
  { severity: "Security", load: "MC-284719", title: "Carrier banking changed", detail: "Payment frozen pending identity verification" },
  { severity: "Docs", load: "AL-10471", title: "POD image unreadable", detail: "Automated replacement request sent" },
];

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS</small></div></div>
        <nav>
          <a className="active" href="#">Autopilot</a><a href="#exceptions">Exceptions</a><a href="#">Loads</a><a href="#">Carriers</a><a href="#">Shippers</a><a href="#">Tracking</a><a href="#">Documents</a><a href="#">Billing</a><a href="#">Automation rules</a>
        </nav>
        <div className="system"><span className="dot" /> Systems operational</div>
      </aside>
      <section className="content">
        <header><div><p className="eyebrow">OPERATIONS CONTROL</p><h1>Autopilot Dashboard</h1><p className="muted">Normal freight stays invisible. You only work the exceptions.</p></div><button>+ New load</button></header>
        <section className="grid stats">{stats.map(([label, value, note]) => <article className="card" key={label}><p>{label}</p><h2>{value}</h2><small>{note}</small></article>)}</section>
        <section className="split">
          <article className="panel" id="exceptions"><div className="panelHead"><div><p className="eyebrow">EXCEPTION CENTER</p><h3>Needs attention</h3></div><span className="badge">4 open</span></div>{exceptions.map((item) => <div className="exception" key={item.load}><div className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</div><div className="grow"><strong>{item.title}</strong><p>{item.load} · {item.detail}</p></div><button className="ghost">Review</button></div>)}</article>
          <article className="panel"><div className="panelHead"><div><p className="eyebrow">AUTOMATION</p><h3>Broker health</h3></div><span className="live">LIVE</span></div><div className="health"><div><span>Carrier matching</span><b>Operational</b></div><div><span>Rate guardrails</span><b>Operational</b></div><div><span>Tracking</span><b>Operational</b></div><div><span>Documents</span><b>Operational</b></div><div><span>Payments</span><b>Review mode</b></div></div><div className="autopilot"><span>NO-TOUCH RATE</span><strong>91.5%</strong><div className="bar"><i /></div><small>Target: 90%</small></div></article>
        </section>
        <section className="panel"><div className="panelHead"><div><p className="eyebrow">RECENT ACTIVITY</p><h3>Automation decisions</h3></div></div><div className="decision"><span className="time">00:02</span><strong>AL-10482 auto-booked</strong><span>Carrier score 94.2 · Margin 15.7%</span><em>AUTO</em></div><div className="decision"><span className="time">23:58</span><strong>AL-10481 search expanded</strong><span>25 → 50 mile pickup radius</span><em>AUTO</em></div><div className="decision"><span className="time">23:51</span><strong>AL-10479 carrier blocked</strong><span>Insurance verification failed</span><em className="blocked">BLOCK</em></div></section>
      </section>
    </main>
  );
}
