"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./demo.module.css";

type SceneKey = "full" | "discover" | "contact" | "outreach" | "reply" | "handoff";

type Scene = {
  key: Exclude<SceneKey, "full">;
  eyebrow: string;
  title: string;
  subtitle: string;
  duration: number;
};

const scenes: Scene[] = [
  { key: "discover", eyebrow: "01 · PROSPECT DISCOVERY", title: "Find companies that actually fit.", subtitle: "ArborLine turns your ideal customer profile into a qualified target list.", duration: 7600 },
  { key: "contact", eyebrow: "02 · DECISION-MAKER ENRICHMENT", title: "Get to the right person.", subtitle: "Verify leadership roles and company-domain work emails before outreach.", duration: 7600 },
  { key: "outreach", eyebrow: "03 · PERSONALIZED OUTREACH", title: "Start relevant conversations.", subtitle: "Generate reviewable outreach using company context instead of generic blasts.", duration: 8000 },
  { key: "reply", eyebrow: "04 · REPLY INTELLIGENCE", title: "Turn replies into the next safe action.", subtitle: "Classify interest, video requests, objections, wrong contacts, and opt-outs.", duration: 8200 },
  { key: "handoff", eyebrow: "05 · QUALIFIED HANDOFF", title: "Move real interest toward revenue.", subtitle: "Keep the context attached as a prospect becomes a sales opportunity.", duration: 7600 }
];

const prospects = [
  ["Northstar Mechanical", "Commercial HVAC", "Chicago, IL", "92"],
  ["Lakefront Climate", "HVAC Service", "Naperville, IL", "88"],
  ["Summit Building Systems", "Mechanical Services", "Milwaukee, WI", "84"],
  ["Prairie Comfort Group", "Commercial HVAC", "Fort Wayne, IN", "81"]
];

function Brand() {
  return (
    <div className={styles.brand}>
      <img src="/brand/arborline-connect-mark.svg" alt="" width={42} height={42} />
      <div><strong>ArborLine <span>Connect</span></strong><small>DEMO DATA · NO REAL OUTREACH</small></div>
    </div>
  );
}

function DiscoverScene({ tick }: { tick: number }) {
  return (
    <div className={styles.workspace}>
      <aside className={styles.filters}>
        <p className={styles.mini}>IDEAL CUSTOMER PROFILE</p>
        <div><span>Industry</span><b>Commercial HVAC</b></div>
        <div><span>Territory</span><b>IL · IN · WI</b></div>
        <div><span>Employees</span><b>5–500</b></div>
        <div><span>Minimum fit</span><b>70 / 100</b></div>
        <button className={styles.fakeButton}>Find matching companies</button>
      </aside>
      <section className={styles.mainPanel}>
        <div className={styles.panelTop}><div><p className={styles.mini}>MATCHING ENGINE</p><h3>Qualified prospect matches</h3></div><span className={styles.good}>4 matched</span></div>
        <div className={styles.tableHeader}><span>Company</span><span>Market</span><span>Location</span><span>Fit</span></div>
        {prospects.map((row, index) => (
          <div className={`${styles.prospectRow} ${tick > index ? styles.revealed : ""}`} key={row[0]}>
            <span><strong>{row[0]}</strong><small>Recurring commercial service fit</small></span><span>{row[1]}</span><span>{row[2]}</span><span className={styles.score}>{row[3]}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function ContactScene({ tick }: { tick: number }) {
  return (
    <div className={styles.contactStage}>
      <section className={styles.companyCard}>
        <p className={styles.mini}>SELECTED PROSPECT</p><h3>Northstar Mechanical</h3><p>Commercial HVAC · Chicago metro</p>
        <div className={styles.scoreRing}><strong>92</strong><span>FIT SCORE</span></div>
      </section>
      <section className={styles.contactCard}>
        <div className={styles.scanLine} />
        <p className={styles.mini}>DECISION-MAKER MATCH</p>
        <div className={styles.avatar}>AM</div>
        <h3>Alex Morgan</h3><p>President</p>
        <div className={`${styles.verifyRow} ${tick > 0 ? styles.on : ""}`}><span>Leadership role</span><b>VERIFIED</b></div>
        <div className={`${styles.verifyRow} ${tick > 1 ? styles.on : ""}`}><span>Company domain</span><b>VERIFIED</b></div>
        <div className={`${styles.verifyRow} ${tick > 2 ? styles.on : ""}`}><span>Work email</span><b>alex@northstar-demo.com</b></div>
        <div className={`${styles.readyBadge} ${tick > 3 ? styles.on : ""}`}>READY FOR REVIEW</div>
      </section>
    </div>
  );
}

function OutreachScene({ tick }: { tick: number }) {
  return (
    <div className={styles.mailStage}>
      <section className={styles.contextRail}>
        <p className={styles.mini}>OUTREACH CONTEXT</p>
        <div><span>Prospect</span><b>Northstar Mechanical</b></div><div><span>Contact</span><b>Alex Morgan · President</b></div><div><span>Vertical</span><b>Commercial HVAC</b></div><div><span>CTA</span><b>90-second video</b></div>
        <span className={styles.safety}>✓ Suppression clear</span><span className={styles.safety}>✓ Exact recipient verified</span><span className={styles.safety}>✓ Staff review required</span>
      </section>
      <section className={styles.emailCard}>
        <div className={styles.emailMeta}><span>To</span><b>Alex Morgan &lt;alex@northstar-demo.com&gt;</b></div>
        <div className={styles.emailMeta}><span>Subject</span><b>Northstar Mechanical — more qualified commercial opportunities?</b></div>
        <div className={styles.emailBody}>
          <p>Hi Alex,</p>
          <p className={tick > 0 ? styles.typed : styles.hiddenLine}>I’m Josh Thomas, founder of ArborLine Connect. I came across Northstar Mechanical and saw you’re the President.</p>
          <p className={tick > 1 ? styles.typed : styles.hiddenLine}>I built ArborLine for HVAC and other recurring-service businesses that want a steadier way to find qualified B2B opportunities.</p>
          <p className={tick > 2 ? styles.typed : styles.hiddenLine}>Would you be open to me sending over a quick 90-second video showing how ArborLine could work for Northstar Mechanical?</p>
        </div>
        <div className={`${styles.reviewBar} ${tick > 3 ? styles.on : ""}`}><span>DRAFT · REVIEW FIRST</span><button className={styles.fakeButton}>Approve draft</button></div>
      </section>
    </div>
  );
}

function ReplyScene({ tick }: { tick: number }) {
  return (
    <div className={styles.replyStage}>
      <section className={styles.inboxCard}>
        <div className={styles.mailIcon}>↩</div><p className={styles.mini}>INBOUND REPLY</p><h3>Alex Morgan · Northstar Mechanical</h3>
        <blockquote>“Yes, send it over. I’d like to see how this would work for us.”</blockquote>
        <div className={`${styles.classification} ${tick > 0 ? styles.on : ""}`}><span>AI classification</span><b>VIDEO REQUESTED</b><small>High confidence</small></div>
      </section>
      <section className={`${styles.videoDraft} ${tick > 1 ? styles.on : ""}`}>
        <p className={styles.mini}>SAFE NEXT ACTION</p><h3>90-second video response</h3><p>Recipient, company, suppression status, and approved video are rechecked.</p>
        <div className={styles.videoMock}><span>▶</span><strong>ARBORLINE CONNECT</strong><small>90-second overview</small></div>
        <div className={styles.reviewBar}><span>{tick > 2 ? "DRAFT READY · NOTHING SENT YET" : "PREPARING REVIEW DRAFT…"}</span><button className={styles.fakeButton}>Approve & send video</button></div>
      </section>
    </div>
  );
}

function HandoffScene({ tick }: { tick: number }) {
  const stages = ["Prospect", "Delivered", "Replied", "Video sent", "Interested", "Booked"];
  return (
    <div className={styles.handoffStage}>
      <section className={styles.funnelCard}>
        <p className={styles.mini}>OPPORTUNITY JOURNEY</p><h3>Northstar Mechanical</h3>
        <div className={styles.progressTrack}>{stages.map((stage, index) => <div key={stage} className={index <= tick ? styles.complete : ""}><i /><span>{stage}</span></div>)}</div>
      </section>
      <section className={`${styles.handoffCard} ${tick > 3 ? styles.on : ""}`}>
        <div className={styles.handoffGlow} /><p className={styles.mini}>QUALIFIED HANDOFF</p><h2>Sales opportunity ready</h2>
        <div className={styles.handoffFacts}><div><span>Company</span><b>Northstar Mechanical</b></div><div><span>Decision maker</span><b>Alex Morgan · President</b></div><div><span>Interest</span><b>Requested demo + follow-up</b></div><div><span>Next step</span><b>Discovery call · Tuesday 10:30 AM</b></div></div>
        <span className={styles.booked}>BOOKED</span>
      </section>
    </div>
  );
}

function SceneView({ scene, tick }: { scene: Scene["key"]; tick: number }) {
  if (scene === "discover") return <DiscoverScene tick={tick} />;
  if (scene === "contact") return <ContactScene tick={tick} />;
  if (scene === "outreach") return <OutreachScene tick={tick} />;
  if (scene === "reply") return <ReplyScene tick={tick} />;
  return <HandoffScene tick={tick} />;
}

export default function DemoExperience({ scene, record }: { scene: string; record: boolean }) {
  const requested = scene as SceneKey;
  const initialIndex = requested === "full" ? 0 : Math.max(0, scenes.findIndex((item) => item.key === requested));
  const [index, setIndex] = useState(initialIndex);
  const [tick, setTick] = useState(0);
  const active = scenes[index];

  useEffect(() => {
    setTick(0);
    const tickTimer = window.setInterval(() => setTick((value) => Math.min(value + 1, 5)), 1150);
    if (requested !== "full") return () => window.clearInterval(tickTimer);
    const sceneTimer = window.setTimeout(() => setIndex((value) => (value + 1) % scenes.length), active.duration);
    return () => { window.clearInterval(tickTimer); window.clearTimeout(sceneTimer); };
  }, [active.duration, requested, index]);

  const progress = useMemo(() => ((index + 1) / scenes.length) * 100, [index]);

  return (
    <div className={styles.demoShell}>
      <header className={styles.topbar}><Brand />{!record && <div className={styles.sceneNav}>{scenes.map((item, i) => <button key={item.key} onClick={() => setIndex(i)} className={i === index ? styles.active : ""}>{String(i + 1).padStart(2, "0")}</button>)}</div>}</header>
      <section className={styles.heroLine}>
        <div><p className={styles.kicker}>{active.eyebrow}</p><h1>{active.title}</h1><p>{active.subtitle}</p></div>
        <div className={styles.demoBadge}>SIMULATED PRODUCT DEMO</div>
      </section>
      <SceneView scene={active.key} tick={tick} />
      <footer className={styles.demoFooter}>
        <div><strong>ArborLine Connect</strong><span>Qualified business connections. Automatically.</span></div>
        <div className={styles.progress}><i style={{ width: `${requested === "full" ? progress : Math.min(100, tick * 20)}%` }} /></div>
        <span>arborlineconnect.com</span>
      </footer>
    </div>
  );
}
