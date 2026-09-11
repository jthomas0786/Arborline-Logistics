import { AppShell } from "@/app/components/AppShell";
import { ShipperShell } from "@/app/components/ShipperShell";
import { requirePageRole } from "@/lib/auth";
import { QuoteForm } from "./quote-form";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const identity = await requirePageRole(["STAFF", "SHIPPER"]);
  const content = <><header><div><p className="eyebrow">SHIPPER INTAKE</p><h1>Create a shipment quote</h1><p className="muted">Price the load, accept the quote, and book transportation in one flow.</p></div></header><QuoteForm /></>;
  return identity.role === "STAFF" ? <AppShell active="New quote">{content}</AppShell> : <ShipperShell active="New quote">{content}</ShipperShell>;
}
