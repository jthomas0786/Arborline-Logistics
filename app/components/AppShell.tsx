import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
import { PushOptIn } from "./PushOptIn";

const items = [
  ["Autopilot", "/"],
  ["New quote", "/shipper/new"],
  ["Loads", "/loads"],
  ["Outbox", "/outbox"],
  ["Exceptions", "/#exceptions"],
  ["Shippers", "/shippers"],
  ["Carriers", "/carriers"],
  ["Tracking", "/tracking"],
  ["Documents", "/documents"],
  ["Billing", "/billing"]
] as const;

export function AppShell({ children, active = "Autopilot" }: { children: ReactNode; active?: string }) {
  return <main className="shell"><aside className="sidebar"><BrandLogo href="/" context="STAFF OPERATIONS" compact/><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><PushOptIn compact/><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure operations console</div></aside><section className="content">{children}</section></main>;
}
