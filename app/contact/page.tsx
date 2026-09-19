import PublicInfoPage, { InfoSection } from "@/app/components/PublicInfoPage";

export default function ContactPage() {
  return <PublicInfoPage eyebrow="CONTACT" title="Talk to the person building ArborLine." intro="Questions about the service, a prospect sample, a Founding Client spot, or an existing ArborLine account can come directly to us.">
    <InfoSection title="Email Josh"><p><a href="mailto:josh@mail.arborlineconnect.com" style={{ color: "#52b8ff", fontWeight: 700 }}>josh@mail.arborlineconnect.com</a></p><p>For sales questions, include your company, service area, and the kinds of commercial accounts you want more of.</p></InfoSection>
    <InfoSection title="Want to see the work first?"><p>You do not need to book a demo just to evaluate the targeting. <a href="/sample" style={{ color: "#52b8ff", fontWeight: 700 }}>Request a free 3–5 company prospect sample</a> and tell ArborLine what a good customer looks like.</p></InfoSection>
    <InfoSection title="Existing client"><p>Use <a href="/login" style={{ color: "#52b8ff", fontWeight: 700 }}>Secure sign in</a> to access your ArborLine Connect portal, conversations, opportunities, targeting, appointments, billing, and account settings.</p></InfoSection>
  </PublicInfoPage>;
}
