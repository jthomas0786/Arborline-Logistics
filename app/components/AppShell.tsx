import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
import { PushOptIn } from "./PushOptIn";

const items = [
  ["Dashboard", "/operations"],
  ["Prospects", "/prospects"],
  ["Campaigns", "/campaigns"],
  ["Appointments", "/appointments"],
  ["Clients", "/clients"],
  ["Outbox", "/outbox"]
] as const;

export function AppShell({ children, active = "Dashboard" }: { children: ReactNode; active?: string }) {
  return <main className="shell"><aside className="sidebar"><BrandLogo href="/operations" context="CONNECT OPERATIONS" compact/><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><PushOptIn compact/><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure Connect console</div></aside><section className="content">{children}</section></main>;
}
