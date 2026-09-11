import type { ReactNode } from "react";

export function ShipperShell({ children, active = "New quote" }: { children: ReactNode; active?: string }) {
  const items = [["New quote", "/shipper/new"]] as const;
  return <main className="shell"><aside className="sidebar"><a className="brand" href="/shipper/new"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · SHIPPER</small></div></a><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure shipper portal</div></aside><section className="content">{children}</section></main>;
}
