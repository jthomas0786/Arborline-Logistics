import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { PortalShell } from "../PortalShell";
import { submitClientOnboarding } from "./actions";
import styles from "../portal.module.css";

export const dynamic = "force-dynamic";

const STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],["DC","District of Columbia"]
] as const;

function joinList(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "";
}

const errorCopy: Record<string,string> = {
  contact: "Add the company name and primary contact name.",
  website: "Use a valid website beginning with http:// or https://, or leave it blank.",
  address: "Complete the U.S. business address with a valid state and ZIP code.",
  services: "Add at least one service, a short service description, and your service area.",
  booking: "Choose the type of next step you want ArborLine to pursue.",
  targeting: "Add at least one target industry, geography, and decision-maker title.",
  employee_range: "Minimum employees cannot be greater than maximum employees.",
  location_range: "Minimum locations cannot be greater than maximum locations.",
  save: "We couldn’t save your setup. Please try again."
};

export default async function ClientOnboardingPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { identity, client } = await requireConnectClient({ allowOnboarding: true });
  if (["ACTIVE","PAUSED","CLOSED"].includes(String(client.status))) redirect("/portal/targeting");

  const params = await searchParams;
  const { rows } = await getPool().query(
    `SELECT target_industries,target_geographies,min_employees,max_employees,min_locations,max_locations,
            facility_types,decision_maker_titles,buying_signals,exclusions,qualification_notes
     FROM connect_icp_profiles WHERE client_id=$1 LIMIT 1`,
    [client.id]
  );
  const profile = rows[0] || {};
  const saved = params.saved === "1";
  const error = params.error ? errorCopy[params.error] || "Review the form and try again." : null;

  return <PortalShell active="Account">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>CLIENT SETUP</p>
        <h1>{client.onboarding_completed_at ? "Review your setup" : "Tell us who ArborLine should find."}</h1>
        <p className={styles.muted}>A few details about your business and ideal customers give ArborLine the rules it needs to qualify opportunities correctly.</p>
      </div>
      <span className={styles.badge}>{client.onboarding_completed_at ? "SUBMITTED FOR REVIEW" : "ABOUT 5 MINUTES"}</span>
    </header>

    {saved ? <div className={`${styles.notice} ${styles.successNotice}`}><strong>Setup submitted.</strong> ArborLine will review your profile and targeting before your campaign goes live. You can still update this form until activation.</div> : null}
    {error ? <div className={`${styles.notice} ${styles.errorNotice}`}><strong>One thing needs attention.</strong> {error}</div> : null}

    <section className={styles.onboardingIntro}>
      <div><span>1</span><strong>Business</strong><small>Who you are</small></div>
      <div><span>2</span><strong>Services</strong><small>What you sell</small></div>
      <div><span>3</span><strong>Targets</strong><small>Who you want</small></div>
      <div><span>4</span><strong>Rules</strong><small>What to avoid</small></div>
    </section>

    <div className={styles.onboardingGuardrail}><strong>Nothing goes live automatically.</strong> Submitting this form moves your account to Ready for Review. ArborLine checks the setup before activating outreach.</div>

    <form action={submitClientOnboarding} className={styles.onboardingForm}>
      <section className={styles.panel}>
        <div className={styles.formSectionHead}>
          <span className={styles.formStep}>1</span>
          <div><p className={styles.eyebrow}>BUSINESS DETAILS</p><h2>Your company</h2><p className={styles.muted}>Use the primary U.S. business location ArborLine should associate with this account.</p></div>
        </div>
        <div className={styles.onboardingGrid}>
          <label className={styles.formField}>Company name<input name="companyName" required maxLength={180} defaultValue={client.company_name || ""}/></label>
          <label className={styles.formField}>Primary contact<input name="primaryContactName" required maxLength={120} defaultValue={client.primary_contact_name || ""}/></label>
          <label className={styles.formField}>Signed-in email<input value={identity.email || client.primary_contact_email || ""} readOnly aria-readonly="true" className={styles.readOnlyInput}/><small>Your portal sign-in email is managed separately for security.</small></label>
          <label className={styles.formField}>Phone <span>optional</span><input name="primaryContactPhone" type="tel" maxLength={60} defaultValue={client.primary_contact_phone || ""}/></label>
          <label className={styles.formField}>Website <span>optional</span><input name="website" type="url" maxLength={300} placeholder="https://yourcompany.com" defaultValue={client.website || ""}/></label>
          <label className={styles.formField}>Industry <span>optional</span><input name="industry" maxLength={120} placeholder="Commercial cleaning" defaultValue={client.industry || ""}/></label>
        </div>

        <div className={styles.addressBlock}>
          <h3>Business address</h3>
          <p className={styles.muted}>United States only for the current ArborLine launch.</p>
          <div className={styles.onboardingGrid}>
            <label className={`${styles.formField} ${styles.fieldWide}`}>Address line 1<input name="businessAddressLine1" required maxLength={180} autoComplete="address-line1" defaultValue={client.business_address_line1 || ""}/></label>
            <label className={`${styles.formField} ${styles.fieldWide}`}>Address line 2 <span>optional</span><input name="businessAddressLine2" maxLength={180} autoComplete="address-line2" defaultValue={client.business_address_line2 || ""}/></label>
            <label className={styles.formField}>City<input name="businessCity" required maxLength={100} autoComplete="address-level2" defaultValue={client.business_city || ""}/></label>
            <label className={styles.formField}>State<select name="businessState" required autoComplete="address-level1" defaultValue={client.business_state || "IL"}>{STATES.map(([code,name]) => <option key={code} value={code}>{name}</option>)}</select></label>
            <label className={styles.formField}>ZIP code<input name="businessPostalCode" required inputMode="numeric" pattern="[0-9]{5}(-[0-9]{4})?" maxLength={10} autoComplete="postal-code" placeholder="60601" defaultValue={client.business_postal_code || ""}/></label>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.formSectionHead}>
          <span className={styles.formStep}>2</span>
          <div><p className={styles.eyebrow}>SERVICES & HANDOFF</p><h2>What you want ArborLine to sell</h2><p className={styles.muted}>Describe recurring services clearly enough that ArborLine can tell a strong prospect from a poor fit.</p></div>
        </div>
        <div className={styles.onboardingGrid}>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Services offered<textarea name="servicesOffered" required rows={3} maxLength={3000} placeholder="Recurring janitorial service, carpet care, floor maintenance" defaultValue={joinList(client.services_offered)}/><small>Separate services with commas or new lines.</small></label>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Service summary<textarea name="serviceSummary" required minLength={20} rows={4} maxLength={1600} placeholder="We provide recurring commercial janitorial service for offices, medical facilities, and multi-tenant properties..." defaultValue={client.service_summary || ""}/></label>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Service area<input name="serviceArea" required maxLength={300} placeholder="Chicago and surrounding suburbs within 30 miles" defaultValue={client.service_area || ""}/><small>Describe where you can realistically serve customers.</small></label>
          <label className={styles.formField}>Preferred handoff<select name="bookingType" required defaultValue={client.booking_type || "CALL"}><option value="CALL">Sales call</option><option value="ESTIMATE">Estimate / quote</option><option value="DEMO">Demo</option><option value="WALKTHROUGH">On-site walkthrough</option><option value="OTHER">Other agreed next step</option></select><small>What should ArborLine try to secure once a prospect is qualified?</small></label>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.formSectionHead}>
          <span className={styles.formStep}>3</span>
          <div><p className={styles.eyebrow}>IDEAL CUSTOMER</p><h2>Who should we pursue?</h2><p className={styles.muted}>These answers become the starting profile for sourcing and qualification.</p></div>
        </div>
        <div className={styles.onboardingGrid}>
          <label className={styles.formField}>Target industries<textarea name="targetIndustries" required rows={3} maxLength={3000} placeholder="Medical offices, property management, professional offices" defaultValue={joinList(profile.target_industries)}/><small>Comma or new-line separated.</small></label>
          <label className={styles.formField}>Target geographies<textarea name="targetGeographies" required rows={3} maxLength={3000} placeholder="Chicago, Oak Brook, DuPage County" defaultValue={joinList(profile.target_geographies) || client.service_area || ""}/><small>Specific cities, counties, or metro areas are best.</small></label>
          <label className={styles.formField}>Facility / account types<textarea name="facilityTypes" rows={3} maxLength={3000} placeholder="Medical office, multi-tenant office, dealership" defaultValue={joinList(profile.facility_types)}/></label>
          <label className={styles.formField}>Decision-maker titles<textarea name="decisionMakerTitles" required rows={3} maxLength={3000} placeholder="Facilities Director, Property Manager, Operations Director" defaultValue={joinList(profile.decision_maker_titles)}/></label>
          <label className={styles.formField}>Minimum employees <span>optional</span><input name="minEmployees" type="number" min={0} inputMode="numeric" defaultValue={profile.min_employees ?? ""}/></label>
          <label className={styles.formField}>Maximum employees <span>optional</span><input name="maxEmployees" type="number" min={0} inputMode="numeric" defaultValue={profile.max_employees ?? ""}/></label>
          <label className={styles.formField}>Minimum locations <span>optional</span><input name="minLocations" type="number" min={0} inputMode="numeric" defaultValue={profile.min_locations ?? ""}/></label>
          <label className={styles.formField}>Maximum locations <span>optional</span><input name="maxLocations" type="number" min={0} inputMode="numeric" defaultValue={profile.max_locations ?? ""}/></label>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Buying signals <span>optional</span><textarea name="buyingSignals" rows={3} maxLength={3000} placeholder="Vendor review, new location, expansion, contract renewal, service complaints" defaultValue={joinList(profile.buying_signals)}/><small>Signals that make a business especially worth contacting.</small></label>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.formSectionHead}>
          <span className={styles.formStep}>4</span>
          <div><p className={styles.eyebrow}>QUALIFICATION RULES</p><h2>What should we avoid?</h2><p className={styles.muted}>Give ArborLine the nuance that keeps weak leads out of your pipeline.</p></div>
        </div>
        <div className={styles.onboardingGrid}>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Exclusions <span>optional</span><textarea name="exclusions" rows={3} maxLength={3000} placeholder="Residential only, restaurants, one-time cleaning, outside service radius, competitors" defaultValue={joinList(profile.exclusions)}/><small>Anything ArborLine should automatically treat as a poor fit.</small></label>
          <label className={`${styles.formField} ${styles.fieldWide}`}>Special qualification notes <span>optional</span><textarea name="qualificationNotes" rows={5} maxLength={3000} placeholder="Example: We prefer recurring accounts with centralized purchasing. Do not count an opportunity until a decision maker agrees to discuss an estimate." defaultValue={profile.qualification_notes || ""}/></label>
        </div>
      </section>

      <section className={styles.onboardingSubmit}>
        <div><strong>{client.onboarding_completed_at ? "Update your setup" : "Submit for ArborLine review"}</strong><p>Submitting does not start outreach. ArborLine reviews the profile first.</p></div>
        <button className={styles.button} type="submit">{client.onboarding_completed_at ? "Save setup changes" : "Submit client setup"}</button>
      </section>
    </form>
  </PortalShell>;
}
