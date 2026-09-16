"use client";

import type { ReactNode, TouchEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import styles from "./AppShell.module.css";

const items = [
  ["Dashboard", "/operations"],
  ["Growth", "/growth"],
  ["Samples", "/growth/samples"],
  ["Prospects", "/prospects"],
  ["Sourcing", "/sourcing"],
  ["Research", "/research"],
  ["Campaigns", "/campaigns"],
  ["Replies", "/replies"],
  ["Appointments", "/appointments"],
  ["Clients", "/clients"]
] as const;

const HELP_TEXT: Record<string, string> = {
  "needs onboarding": "Clients whose account setup or onboarding still needs completion or staff review.",
  "customer requests": "Open requests submitted by clients, including targeting, account, or workflow changes.",
  "opportunity attention": "Prospects that need qualification review plus qualified prospects that still need staff follow-through.",
  "qualified / not ready": "Prospects that fit the target profile but do not yet have everything needed for the next outreach step.",
  "coming up": "Qualified appointments or handoffs that are scheduled and have not happened yet.",
  "follow-up / no-show": "Conversations that need another touch because follow-up was requested or the scheduled meeting was missed.",
  "open estimate value": "Customer-reported recurring monthly value tied to estimates that have been sent but not yet marked won or lost.",
  "won monthly value": "Customer-reported recurring monthly value from opportunities marked Won.",
  "portfolio revenue multiple": "Won recurring monthly value divided by the monthly ArborLine fee base for active-billing clients. This is a revenue comparison, not profit ROI.",
  "revenue multiple": "Won recurring monthly value divided by the ArborLine monthly fee. This is a revenue comparison, not profit ROI.",
  "revenue roi": "The percentage difference between customer-reported won recurring monthly value and the ArborLine monthly fee. It is not profit ROI.",
  "active clients": "Connect customers currently marked Active.",
  "qualified opportunities": "Prospects that passed the configured ICP qualification threshold.",
  "actionable qualified": "Qualified prospects in an active outreach stage with no completed handoff yet.",
  "qualified handoffs": "Qualified opportunities that have advanced into the handoff or appointment workflow.",
  "estimates sent": "Handoffs where the customer reported that an estimate was sent.",
  "wins": "Handoffs where the customer reported the opportunity as Won.",
  "losses": "Handoffs where the customer reported the opportunity as Lost.",
  "what needs staff attention": "A prioritized work queue. Higher-impact customer, reply, handoff, and exception work appears ahead of lower-stage prospect work.",
  "qualified → handoffs → estimates → wins": "A portfolio-level view of how qualified prospects progress toward customer-reported revenue outcomes.",
  "scheduled appointments and handoffs": "Upcoming qualified conversations, plus any scheduled items that are already past due.",
  "no-shows and follow-up needed": "Open conversations that require another action after a missed meeting or a customer-requested follow-up.",
  "meaningful updates across all clients": "Recent customer-facing changes such as requests, onboarding completion, portal activation, and reported outcomes.",
  "every connect customer in one operating view": "A compact per-client summary of work queues, handoffs, outcomes, and reported revenue value.",
  "total prospects": "All prospects currently in the selected client scope, regardless of qualification or outreach stage.",
  "qualification review": "Prospects that still need a fit or enrichment decision before ArborLine treats them as qualified.",
  "handoff / booked": "Qualified prospects that have advanced to a handoff or booked conversation.",
  "jump to the work that matters": "Quick filters for the main prospect workflow lanes so different types of work do not get mixed together.",
  "scored prospect pipeline": "The prospect list organized by qualification and outreach state, with the highest-attention work shown first.",
  "fit score": "ArborLine's ICP qualification score based on the configured campaign rules. It is a targeting score, not a guarantee of interest.",
  "pipeline lane": "The operational bucket that explains what kind of work, if any, this prospect needs next.",
  "outreach": "The current outbound status for the prospect, such as Not Ready, Ready, Queued, Contacted, Replied, or Booked.",
  "drafts awaiting review": "Personalized outreach drafts that exist but still require a human approval decision before they can enter the send queue.",
  "queued": "Approved messages waiting for controlled sending. Queued does not mean the message has been delivered.",
  "final safety gate": "Before a message is sent, ArborLine rechecks qualification, the exact recipient, and suppression status.",
  "live prospect outreach": "Whether production prospect delivery is fully configured and allowed to run.",
  "production send prerequisites": "Compliance and configuration checks required before live prospect delivery is allowed.",
  "exactly what arborline would send": "The human review queue showing the recipient, subject, and full message before approval.",
  "test a queued email without contacting the prospect": "Sends the queued message only to a test address so formatting and content can be checked safely.",
  "production sending is compliance-gated": "The protections ArborLine enforces around suppression, unsubscribe handling, sender identity, and rate limits.",
  "acquisition funnel": "Campaign progress from sourced prospects through qualification, buyer coverage, outreach, replies, and handoff outcomes.",
  "buyer covered": "Prospects with a usable buyer or decision-maker email that is not currently suppressed.",
  "research backlog": "Self-discovered prospects that still need more company, decision-maker, or contact research before they can progress.",
  "contacted": "Prospects where production outreach has been attempted.",
  "delivered": "Prospects whose outreach provider reported successful delivery.",
  "replied": "Prospects with a matched inbound reply.",
  "delivery issues": "Prospects with a bounce, complaint, or failed delivery state that needs attention.",
  "client": "The ArborLine customer whose prospects, campaigns, or results are being shown.",
  "opportunity lanes": "Counts of prospects grouped by the type of operational work they currently require.",
  "requests / handoffs": "Open client requests plus handoffs that are waiting for staff attention.",
  "upcoming": "Scheduled handoffs or appointments that have not occurred yet.",
  "companies discovered": "Public-source company candidates ArborLine found during discovery cycles in the last 24 hours.",
  "new prospects": "New self-discovered companies inserted after deduplication in the last 24 hours.",
  "high-confidence decision-makers": "Decision-makers scoring at least 85 confidence. Only this tier can be promoted into contact name/title fields by public research.",
  "discovery safety": "Checks whether recently self-discovered prospects remain outside outreach until later verification and approval gates are satisfied.",
  "discovery scheduler": "The hourly 24/7 company-discovery loop and its current health, rotation, and timing.",
  "last discovery run": "When the most recent ArborLine public-discovery cycle started.",
  "next discovery run": "The next scheduled hourly discovery cycle. GitHub scheduling can start slightly after the target minute.",
  "current rotation": "The prospect segment and geography handled by the most recent discovery cycle.",
  "rotation slot": "The current position in the segment-by-geography rotation used to spread discovery work over time.",
  "completed runs": "Successful public-discovery cycles during the last 24 hours.",
  "failed runs": "Public-discovery cycles that ended in an error during the last 24 hours.",
  "outreach separation": "Discovery and research cannot send prospect email. Sending remains a separate approval-gated workflow.",
  "discovery quality": "How newly discovered prospects are progressing through fit scoring and website research.",
  "inserted prospects": "Self-discovered companies saved as new prospect records after duplicate checks.",
  "needs review": "Self-discovered prospects with plausible fit that still need missing or stronger evidence before qualification.",
  "website researched": "Self-discovered prospects that have received an ArborLine public-company website research pass.",
  "email candidate pipeline": "Published and inferred email candidates found during research before verification promotes any address into the usable contact field.",
  "published email candidates": "Email addresses visibly published on the company domain and captured as unverified research evidence.",
  "inferred email candidates": "Likely company email patterns generated from a high-confidence decision-maker name. These are not treated as verified.",
  "published waiting verification": "Published email candidates that still need the verification gate before use.",
  "inferred waiting verification": "Pattern-inferred email candidates that still need verification before use.",
  "what arborline is finding": "The most recent companies found by ArborLine's own public discovery engine, including fit and research state.",
  "recent hourly cycles": "Recent public-discovery runs showing which segment/geography was searched and what each cycle produced."
};

function normalizedHelpLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function AppShell({ children, active = "Dashboard" }: { children: ReactNode; active?: string }) {
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const currentX = useRef<number | null>(null);
  const currentY = useRef<number | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const selectors = [".card > p", ".panelHead h3", ".health span", "th"].join(",");
    const injected: HTMLElement[] = [];

    root.querySelectorAll<HTMLElement>(selectors).forEach((target) => {
      if (target.querySelector("[data-arborline-help]")) return;
      const label = normalizedHelpLabel(target.textContent || "");
      const help = HELP_TEXT[label];
      if (!help) return;

      const icon = document.createElement("button");
      icon.type = "button";
      icon.className = styles.infoDot;
      icon.dataset.arborlineHelp = "true";
      icon.dataset.help = help;
      icon.title = help;
      icon.setAttribute("aria-label", `${target.textContent?.trim() || "Metric"}: ${help}`);
      icon.textContent = "i";
      target.appendChild(icon);
      injected.push(icon);
    });

    return () => injected.forEach((icon) => icon.remove());
  }, []);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    currentX.current = touch.clientX;
    currentY.current = touch.clientY;
  }

  function onTouchMove(event: TouchEvent<HTMLElement>) {
    if (startX.current === null || startY.current === null) return;
    const touch = event.touches[0];
    if (!touch) return;
    currentX.current = touch.clientX;
    currentY.current = touch.clientY;
    const deltaX = touch.clientX - startX.current;
    const deltaY = touch.clientY - startY.current;
    if (Math.abs(deltaX) > 18 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) event.preventDefault();
  }

  function onTouchEnd() {
    if (startX.current === null || startY.current === null || currentX.current === null || currentY.current === null) {
      startX.current = null; startY.current = null; currentX.current = null; currentY.current = null; return;
    }
    const deltaX = currentX.current - startX.current;
    const deltaY = currentY.current - startY.current;
    const horizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
    if (horizontalSwipe && !open && deltaX > 70) setOpen(true);
    if (horizontalSwipe && open && deltaX < -60) setOpen(false);
    startX.current = null; startY.current = null; currentX.current = null; currentY.current = null;
  }

  return <main className={`shell ${styles.shell}`} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
    <div className={styles.mobileBar}>
      <button className={styles.hamburger} onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open}><span/><span/><span/></button>
      <BrandLogo href="/operations" context="CONNECT" compact/>
    </div>
    <button className={`${styles.backdrop} ${open ? styles.backdropOpen : ""}`} aria-label="Close navigation" onClick={() => setOpen(false)} />
    <aside className={`sidebar ${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
      <div className={styles.drawerHead}><BrandLogo href="/operations" context="CONNECT OPERATIONS" compact/><button className={styles.close} onClick={() => setOpen(false)} aria-label="Close navigation">×</button></div>
      <nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label} onClick={() => setOpen(false)}>{label}</a>)}</nav>
      <form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form>
      <div className="system"><span className="dot" /> Secure Connect console</div>
    </aside>
    <section ref={contentRef} className={`content ${styles.content}`}>
      <div className={styles.helpHint}><span className={styles.infoSample}>i</span><span>Hover or tap info icons for plain-English definitions.</span></div>
      {children}
    </section>
  </main>;
}
