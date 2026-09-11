import type { ReactNode } from "react";

const items = [
  ["Autopilot", "/"],
  ["New quote", "/shipper/new"],
  ["Loads", "/loads"],
  ["Carriers", "/carriers"],
  ["Outbox", "/outbox"],
  ["Exceptions", "/#exceptions"],
  ["Tracking", "/#tracking"],
  ["Documents", "/#documents"],
  ["Billing", "/#billing"]
] as const;

export function AppShell({ children, active = "Autopilot" }: { children: ReactNode; active?: string }) {
  return <main className="shell"><aside className="sidebar"><a className="brand" href="/"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS</small></div></a><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><div className="system"><span className="dot" /> Autopilot foundation online</div></aside><section className="content">{children}</section></main>;
}
