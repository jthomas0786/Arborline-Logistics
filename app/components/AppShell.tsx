import type { ReactNode } from "react";

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
  return <main className="shell"><aside className="sidebar"><a className="brand" href="/"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · STAFF</small></div></a><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure operations console</div></aside><section className="content">{children}</section></main>;
}
