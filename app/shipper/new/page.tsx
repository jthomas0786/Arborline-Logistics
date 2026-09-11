import { AppShell } from "@/app/components/AppShell";
import { QuoteForm } from "./quote-form";

export default function NewQuotePage() {
  return <AppShell active="New quote"><header><div><p className="eyebrow">SHIPPER INTAKE</p><h1>Create a shipment quote</h1><p className="muted">Price the load, accept the quote, and launch carrier search in one flow.</p></div></header><QuoteForm /></AppShell>;
}
