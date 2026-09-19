import PublicInfoPage, { InfoSection } from "@/app/components/PublicInfoPage";

export default function DataPracticesPage() {
  return <PublicInfoPage eyebrow="DATA & OUTREACH PRACTICES" title="Quality controls before outreach reaches an inbox." intro="ArborLine is designed to help service businesses prospect responsibly without treating every record in a database as a person worth contacting. These are the operating principles behind that workflow.">
    <InfoSection title="Public-source research"><p>ArborLine may use public business directories, company websites, openly accessible professional information, mapping/business datasets, and other lawful public sources to identify potential business accounts. A category label or directory entry alone is not treated as proof that a company fits a campaign.</p></InfoSection>
    <InfoSection title="Service-fit verification"><p>Self-discovered companies are checked for evidence that they actually match the client’s service and customer criteria. Records can remain in review or be rejected when that evidence is weak, conflicting, or unavailable.</p></InfoSection>
    <InfoSection title="Decision-maker and email checks"><p>ArborLine separates company discovery from contact verification. Outreach requires a credible person identity, an appropriate role, a matching work email, and verification checks before a contact is eligible to move into a live campaign.</p></InfoSection>
    <InfoSection title="Human approval and send controls"><p>Prospect research and prepared drafts are not automatically equivalent to send authorization. Outreach moves through review, qualification, recipient, suppression, and approval controls before a message can enter a live send queue.</p></InfoSection>
    <InfoSection title="Replies, bounces, and opt-outs"><p>ArborLine records replies and delivery events so follow-up can stop when it should. Suppressions, opt-outs, complaints, hard bounces, and other safety states are used to prevent inappropriate additional outreach.</p></InfoSection>
    <InfoSection title="No access-control bypass"><p>ArborLine’s public research workflow is not intended to bypass logins, CAPTCHAs, private profiles, or access controls. When a source is not openly accessible, it is not treated as public research merely because information might exist behind it.</p></InfoSection>
  </PublicInfoPage>;
}
