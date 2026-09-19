import PublicInfoPage, { InfoSection } from "@/app/components/PublicInfoPage";

export default function TermsPage() {
  return <PublicInfoPage eyebrow="TERMS" title="Straightforward terms for using ArborLine." intro="These website terms describe the general rules for using ArborLine Connect. Client-specific commercial terms may also be governed by an accepted order, checkout, statement of work, or other written agreement. Last updated September 19, 2026.">
    <InfoSection title="The service"><p>ArborLine Connect provides prospect research, qualification, outreach support, reply processing, opportunity handoff, reporting, and related customer-acquisition workflow services. Features and workflows may evolve as the service improves.</p></InfoSection>
    <InfoSection title="No guaranteed outcome"><p>Prospecting and sales results depend on the market, offer, territory, competition, customer response, and other factors outside ArborLine’s control. ArborLine does not guarantee a specific number of replies, appointments, estimates, contracts, or sales.</p></InfoSection>
    <InfoSection title="Client responsibilities"><p>Clients are responsible for providing accurate business and targeting information, using opportunities lawfully, honoring commitments made to prospects, and keeping portal credentials or access links secure.</p></InfoSection>
    <InfoSection title="Billing and cancellation"><p>Pricing, billing cadence, cancellation rights, and any promotional or Founding Client terms are the terms presented and accepted at enrollment or checkout. Unless a separate agreement says otherwise, ArborLine does not create a long-term commitment merely by accepting an application.</p></InfoSection>
    <InfoSection title="Acceptable use"><p>ArborLine may not be used to promote unlawful activity, impersonate another person or business, misrepresent an offer, evade opt-outs, or intentionally target suppressed or prohibited recipients.</p></InfoSection>
    <InfoSection title="Questions"><p>Questions about ArborLine’s terms can be sent to <a href="mailto:josh@mail.arborlineconnect.com" style={{ color: "#52b8ff" }}>josh@mail.arborlineconnect.com</a>.</p></InfoSection>
  </PublicInfoPage>;
}
