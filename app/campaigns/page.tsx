import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await requirePageRole(["STAFF"]);
  return <AppShell active="Campaigns"><header><div><p className="eyebrow">OUTBOUND AUTOMATION</p><h1>Campaigns</h1><p className="muted">Personalized B2B outreach, follow-up, suppression, and reply routing will live here.</p></div></header><section className="panel"><div className="panelHead"><div><p className="eyebrow">CAMPAIGN GUARDRAILS</p><h3>Built to protect deliverability and trust</h3></div></div><div className="health"><div><span>Verified sending domain via Resend</span><b>Setup pending</b></div><div><span>Accurate sender identity</span><b>Required</b></div><div><span>Automatic opt-out suppression</span><b>Required</b></div><div><span>Sequence stop on reply</span><b>Required</b></div><div><span>Personalization from prospect context</span><b>Planned</b></div></div></section></AppShell>;
}
