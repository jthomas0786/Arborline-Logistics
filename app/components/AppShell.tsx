"use client";

import type { ReactNode, TouchEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { PushOptIn } from "./PushOptIn";
import styles from "./AppShell.module.css";

const items = [
  ["Dashboard", "/operations"],
  ["Prospects", "/prospects"],
  ["Sourcing", "/sourcing"],
  ["Campaigns", "/campaigns"],
  ["Appointments", "/appointments"],
  ["Clients", "/clients"],
  ["Outbox", "/outbox"]
] as const;

export function AppShell({ children, active = "Dashboard" }: { children: ReactNode; active?: string }) {
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const currentX = useRef<number | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const x = event.touches[0]?.clientX ?? null;
    if (open || (x !== null && x <= 36)) {
      startX.current = x;
      currentX.current = x;
    }
  }

  function onTouchMove(event: TouchEvent<HTMLElement>) {
    if (startX.current === null) return;
    currentX.current = event.touches[0]?.clientX ?? currentX.current;
  }

  function onTouchEnd() {
    if (startX.current === null || currentX.current === null) return;
    const delta = currentX.current - startX.current;
    if (!open && delta > 70) setOpen(true);
    if (open && delta < -60) setOpen(false);
    startX.current = null;
    currentX.current = null;
  }

  return <main className={`shell ${styles.shell}`} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
    <div className={styles.mobileBar}>
      <button className={styles.hamburger} onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open}>
        <span/><span/><span/>
      </button>
      <BrandLogo href="/operations" context="CONNECT" compact/>
    </div>
    <button className={`${styles.backdrop} ${open ? styles.backdropOpen : ""}`} aria-label="Close navigation" onClick={() => setOpen(false)} />
    <aside className={`sidebar ${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
      <div className={styles.drawerHead}>
        <BrandLogo href="/operations" context="CONNECT OPERATIONS" compact/>
        <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close navigation">×</button>
      </div>
      <nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label} onClick={() => setOpen(false)}>{label}</a>)}</nav>
      <PushOptIn compact/>
      <form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form>
      <div className="system"><span className="dot" /> Secure Connect console</div>
    </aside>
    <section className={`content ${styles.content}`}>{children}</section>
  </main>;
}
