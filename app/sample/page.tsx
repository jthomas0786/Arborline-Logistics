import styles from "../connect.module.css";
import { SampleViewTracker } from "./SampleViewTracker";

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <span className={`${styles.brandLockup} ${compact ? styles.brandLockupCompact : ""}`}>
    <img src="/brand/arborline-connect-mark.svg" alt="" width={compact ? 42 : 54} height={compact ? 42 : 54}/>
    <span className={styles.brandWordmark}>Arbor<span>Line</span> <b>Connect</b></span>
  </span>;
}

export default async function FreeSamplePage({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string; alc?: string }> }) {
  const params = await searchParams;
  const submitted = params.submitted === "1";
  const error = params.error === "invalid";
  const trackingToken = typeof params.alc === "string" ? params.alc.trim().slice(0, 500) : "";

  return <main className={styles.page}>
    {trackingToken ? <SampleViewTracker token={trackingToken}/> : null}
    <header className={styles.nav}>
      <a className={styles.brandLink} href="/" aria-label="ArborLine Connect home"><BrandLockup/></a>
      <nav><a href="/">Home</a><a href="/#how">How it works</a><a href="/#pilot">Founding Client</a><a className={styles.signIn} href="/login">Sign in</a></nav>
    </header>

    <section className={styles.pilot} style={{paddingTop:72}}>
      <div className={styles.pilotCopy}>
        <p className={styles.kicker}>FREE PROSPECT SAMPLE</p>
        <h2>See the kind of businesses ArborLine could put in your pipeline.</h2>
        <p>Tell us what your business does and who your ideal customer is. ArborLine will use your target profile to prepare a small sample of matching businesses so you can judge the fit before becoming a client.</p>
        <p className={styles.micro}><strong>Current Founding Client focus:</strong> commercial cleaning. Other B2B service companies can still request a sample, including HVAC, landscaping, staffing, roofing, pest control, fire protection, and commercial plumbing.</p>
        <ul>
          <li>3–5 companies matched to your target market</li>
          <li>Focused on the geography and customer profile you choose</li>
          <li>Built from the same qualification logic used in ArborLine Connect</li>
          <li>No payment information required</li>
          <li>No automatic enrollment or outreach on your behalf</li>
        </ul>
        <p className={styles.micro}>A sample is an evaluation aid, not a guarantee that every company will become a sales opportunity. ArborLine does not contact sample companies on your behalf unless you later become a client and approve that workflow.</p>
      </div>

      <form className={styles.form} method="post" action="/api/public/free-sample">
        {submitted && <div className={styles.success}>Request received. Your free prospect sample is now in the ArborLine review queue.</div>}
        {error && <div className={styles.error}>Please enter your name, company, a valid work email, and who you want to reach.</div>}
        <div className={styles.formRow}><label>Your name<input name="name" autoComplete="name" maxLength={120} required/></label><label>Work email<input name="email" type="email" autoComplete="email" maxLength={200} required/></label></div>
        <div className={styles.formRow}><label>Company<input name="company" autoComplete="organization" maxLength={180} required/></label><label>Your industry<input name="industry" placeholder="e.g. Commercial cleaning, HVAC, landscaping" maxLength={120}/></label></div>
        <div className={styles.formRow}><label>Target geography<input name="serviceArea" placeholder="e.g. Chicago metro, Illinois, Midwest, nationwide" maxLength={180}/></label><label>Website<input name="website" type="url" placeholder="https://" maxLength={300}/></label></div>
        <label>Who is your ideal customer?<textarea name="targetCustomer" rows={4} maxLength={1400} required placeholder="Example: Commercial property managers, medical offices, and professional buildings within 30 miles that need recurring janitorial service."/></label>
        <label>Who usually makes the buying decision?<input name="decisionMakerTitles" maxLength={400} placeholder="Example: Facility Manager, Property Manager, Operations Director, Office Manager"/></label>
        <label>Anything else ArborLine should use when matching?<textarea name="notes" rows={3} maxLength={1000} placeholder="Optional: target company size, facility type, exclusions, buying signals, contract size, or other preferences."/></label>
        <label className={styles.honeypot} aria-hidden="true">Leave this empty<input name="website_url" tabIndex={-1} autoComplete="off"/></label>
        <button type="submit">Request my free prospect sample</button>
        <small>This request does not create a paid account, enroll you in outreach, or authorize ArborLine to contact prospects on your behalf.</small>
      </form>
    </section>

    <section className={styles.markets}>
      <div className={styles.sectionIntro}><p className={styles.kicker}>WHAT HAPPENS NEXT</p><h2>A small proof before a bigger commitment.</h2><p>Your request lands in ArborLine's Growth queue. We review your business, target market, geography, and buyer profile, prepare a small matching sample, and use the result to show what a full ArborLine Connect campaign could look like.</p></div>
      <div className={styles.marketList}><span>Business + target profile captured</span><span>Match quality reviewed</span><span>3–5 sample businesses</span><span>No automatic sending</span></div>
    </section>

    <footer className={styles.footer}><BrandLockup compact/><p>Connecting the right businesses to the right opportunities.</p><a href="/">Back to ArborLine Connect</a></footer>
  </main>;
}
