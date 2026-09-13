import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

function joinList(value: unknown) {
  return Array.isArray(value) && value.length ? value.join(", ") : "Not set yet";
}

export default async function AccountPage() {
  const { identity, client } = await requireConnectClient();
  const campaignActive = client.status === "ACTIVE";
  const statusLabel = campaignActive ? "Campaign active" : String(client.status || "SETUP").replaceAll("_", " ");
  const address = [
    client.business_address_line1,
    client.business_address_line2,
    [client.business_city,client.business_state].filter(Boolean).join(", "),
    client.business_postal_code
  ].filter(Boolean).join(" · ") || "Not set yet";
  const setupEditable = client.status === "READY" && Boolean(client.onboarding_completed_at);

  return <PortalShell active="Account">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>ACCOUNT</p>
        <h1>{client.company_name}</h1>
        <p className={styles.muted}>Your company profile and ArborLine Connect access details.</p>
      </div>
      <span className={styles.campaignBadge}><span className={`${styles.statusDot} ${campaignActive ? styles.statusDotActive : ""}`}/>{statusLabel}</span>
    </header>

    {setupEditable ? <div className={styles.notice}><strong>Setup submitted for review.</strong> You can still update these details until ArborLine activates the campaign.</div> : null}

    <section className={styles.grid2}>
      <article className={styles.panel}>
        <h2>Company profile</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>Company</strong><p>{client.company_name}</p></div>
          <div className={styles.item}><strong>Industry</strong><p>{client.industry || "Not set yet"}</p></div>
          <div className={styles.item}><strong>Business address</strong><p>{address}</p></div>
          <div className={styles.item}><strong>Service area</strong><p>{client.service_area || "Not set yet"}</p></div>
          <div className={styles.item}><strong>Services offered</strong><p>{joinList(client.services_offered)}</p></div>
          <div className={styles.item}><strong>Primary contact</strong><p>{client.primary_contact_name || "Not set yet"}{client.primary_contact_email ? ` · ${client.primary_contact_email}` : ""}{client.primary_contact_phone ? ` · ${client.primary_contact_phone}` : ""}</p></div>
          <div className={styles.item}><strong>Website</strong><p>{client.website ? <a className={styles.textLink} href={client.website} target="_blank" rel="noreferrer">{client.website}</a> : "Not set yet"}</p></div>
        </div>
      </article>

      <aside className={styles.panel}>
        <h2>Portal access</h2>
        <div className={styles.list}>
          <div className={styles.item}><strong>Signed in as</strong><p>{identity.email || client.primary_contact_email || "Client user"}</p></div>
          <div className={styles.item}><strong>Sign-in method</strong><p>Secure email link. No password is stored in ArborLine.</p></div>
          <div className={styles.item}><strong>Portal role</strong><p>Client access for {client.company_name}</p></div>
          <div className={styles.item}><strong>Campaign status</strong><p>{statusLabel}</p></div>
          <div className={styles.item}><strong>Client setup</strong><p>{client.onboarding_completed_at ? `Submitted ${new Date(client.onboarding_completed_at).toLocaleDateString()}` : "Not submitted yet"}</p></div>
        </div>
      </aside>
    </section>

    <section className={styles.panel} style={{marginTop:16}}>
      <h2>What ArborLine is working from</h2>
      <p className={styles.muted}>This summary is the service context ArborLine uses alongside your targeting profile when qualifying opportunities.</p>
      <div className={styles.summaryBox}>{client.service_summary || "Your service summary is still being configured."}</div>
      <div className={styles.accountActions}>
        <a className={styles.button} href="/portal/targeting">Review targeting</a>
        {setupEditable ? <a className={styles.secondaryButton} href="/portal/onboarding">Update setup</a> : null}
        <a className={styles.secondaryButton} href="/portal/billing">View billing</a>
      </div>
    </section>

    <div className={styles.notice} style={{marginTop:16}}>Need a company-profile change or another teammate added? Reply to your ArborLine email and we’ll update the account.</div>
  </PortalShell>;
}
