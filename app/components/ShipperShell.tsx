import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
import { PushOptIn } from "./PushOptIn";

export function ShipperShell({ children, active = "New quote" }: { children: ReactNode; active?: string }) {
  const items = [["New quote", "/shipper/new"],["Account", "/shipper/account"]] as const;
  return <main className="shell"><aside className="sidebar"><BrandLogo href="/shipper/new" context="SHIPPER PORTAL" compact/><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><PushOptIn compact/><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure shipper portal</div></aside><section className="content">{children}</section></main>;
}
