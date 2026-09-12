import type { ReactNode } from "react";
import { PushOptIn } from "./PushOptIn";

export function ShipperShell({ children, active = "New quote" }: { children: ReactNode; active?: string }) {
  const items = [["New quote", "/shipper/new"],["Account", "/shipper/account"]] as const;
  const pushKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  return <main className="shell"><aside className="sidebar"><a className="brand" href="/shipper/new"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS · SHIPPER</small></div></a><nav>{items.map(([label,href]) => <a className={active === label ? "active" : ""} href={href} key={label}>{label}</a>)}</nav><PushOptIn publicKey={pushKey} compact/><form action="/auth/signout" method="post"><button type="submit" className="sidebarSignout">Sign out</button></form><div className="system"><span className="dot" /> Secure shipper portal</div></aside><section className="content">{children}</section></main>;
}
