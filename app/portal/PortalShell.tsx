import type { ReactNode } from "react";
import { BrandLogo } from "../components/BrandLogo";
import styles from "./portal.module.css";

const nav = [
  ["Dashboard", "/portal"],
  ["Opportunities", "/portal/opportunities"],
  ["Conversations", "/portal/conversations"],
  ["Appointments", "/portal/appointments"],
  ["Targeting", "/portal/targeting"],
  ["Billing", "/portal/billing"]
] as const;

export function PortalShell({ children, active = "Dashboard" }: { children: ReactNode; active?: string }) {
  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <BrandLogo href="/portal" context="CLIENT PORTAL" compact/>
      <nav className={styles.nav}>
        {nav.map(([label,href]) => <a key={label} href={href} className={active === label ? styles.active : ""}>{label}</a>)}
      </nav>
      <form action="/auth/signout" method="post"><button type="submit" className={styles.signout}>Sign out</button></form>
    </aside>
    <section className={styles.main}>{children}</section>
  </main>;
}
