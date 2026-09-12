import styles from "./connect.module.css";

const workflow = [
  ["01", "Define the target", "Tell ArborLine Connect the industries, geography, company size, service needs, and decision makers you want to reach."],
  ["02", "Find the right businesses", "The system builds and scores a prospect list around your ideal customer profile instead of handing you a generic database."],
  ["03", "Start real conversations", "Personalized outreach and follow-up are designed to create relevant conversations while honoring opt-outs and suppression rules."],
  ["04", "Qualify and connect", "Interested prospects are qualified against your rules and handed off as booked calls, estimates, or walkthroughs."],
] as const;

const capabilities = [
  ["Prospect discovery", "Identify businesses that match the customers you actually want."],
  ["Personalized outreach", "Turn company context into relevant, human-readable outreach at scale."],
  ["Reply qualification", "Separate interest, objections, wrong contacts, and opt-outs automatically."],
  ["Appointment handoff", "Move qualified interest into a scheduled conversation with the right context attached."],
] as const;

const markets = ["Commercial cleaning", "Pest control", "Landscaping", "Facility services", "Managed IT", "Other recurring B2B services"];

export default async function Home({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const submitted = params.submitted === "1";
  const error = params.error === "invalid";

  return <main className={styles.page}>
    <header className={styles.nav}>
      <a className={styles.brand} href="/" aria-label="ArborLine Connect home">
        <img src="/brand/arborline-badge.png" alt="" width={54} height={54}/>
        <span>Arbor<span>Line</span> <b>Connect</b></span>
      </a>
      <nav><a href="#how">How it works</a><a href="#qualified">Qualified means qualified</a><a href="#pilot">Pilot</a><a className={styles.signIn} href="/login">Sign in</a></nav>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>AUTOMATED B2B CONNECTIONS</p>
        <h1>Qualified business connections. <span>Automatically.</span></h1>
        <p className={styles.lede}>ArborLine Connect finds the right businesses, starts the conversation, qualifies real interest, and helps put sales opportunities on your calendar.</p>
        <div className={styles.heroActions}><a className={styles.primary} href="#pilot">Request pilot access</a><a className={styles.secondary} href="#how">See the workflow</a></div>
        <p className={styles.micro}>Launching first for recurring commercial service businesses. No purchased “lead lists” passed off as appointments.</p>
      </div>
      <div className={styles.connectVisual} aria-label="ArborLine Connect workflow illustration">
        <div className={styles.node}><small>YOUR BUSINESS</small><strong>A</strong><span>Ideal customer profile</span></div>
        <div className={styles.signal}><i/><i/><i/></div>
        <div className={styles.centerNode}><img src="/brand/arborline-badge.png" alt="" width={82} height={82}/><strong>ArborLine Connect</strong><span>Discover · qualify · schedule</span></div>
        <div className={styles.signal}><i/><i/><i/></div>
        <div className={styles.node}><small>RIGHT PROSPECT</small><strong>B</strong><span>Qualified conversation</span></div>
      </div>
    </section>

    <section className={styles.capabilityGrid}>{capabilities.map(([title, text]) => <article key={title}><div className={styles.capabilityIcon}>↗</div><h2>{title}</h2><p>{text}</p></article>)}</section>

    <section className={styles.workflow} id="how">
      <div className={styles.sectionIntro}><p className={styles.kicker}>THE CONNECT ENGINE</p><h2>From target account to real conversation.</h2><p>The goal is to automate the repetitive sales work without pretending every contact is a qualified opportunity.</p></div>
      <div className={styles.steps}>{workflow.map(([number,title,text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    </section>

    <section className={styles.qualified} id="qualified">
      <div><p className={styles.kicker}>OUR STANDARD</p><h2>A meeting is not “qualified” just because someone clicked yes.</h2><p>A Connect handoff should fit the client’s territory and service profile, reach a real decision maker or influencer, show legitimate need or buying timing, and contain enough context for the provider to walk into the conversation prepared.</p></div>
      <div className={styles.criteria}>
        <div><span>01</span><strong>Right company</strong><p>Matches geography, industry, size, and service criteria.</p></div>
        <div><span>02</span><strong>Right person</strong><p>Decision maker or someone directly involved in the buying process.</p></div>
        <div><span>03</span><strong>Real reason to talk</strong><p>Current need, upcoming review, new location, vendor issue, or relevant timing.</p></div>
        <div><span>04</span><strong>Agreed next step</strong><p>A specific call, estimate, demo, or walkthrough—not an unverified contact record.</p></div>
      </div>
    </section>

    <section className={styles.markets}>
      <div className={styles.sectionIntro}><p className={styles.kicker}>START NARROW. EXPAND LATER.</p><h2>Built for businesses where one good customer matters.</h2><p>Commercial cleaning is the first pilot market because the ideal buyers and decision makers are straightforward to define. The Connect engine is intentionally broader than one industry.</p></div>
      <div className={styles.marketList}>{markets.map((market) => <span key={market}>{market}</span>)}</div>
    </section>

    <section className={styles.pilot} id="pilot">
      <div className={styles.pilotCopy}><p className={styles.kicker}>FOUNDING PILOT</p><h2>Interested in being an early ArborLine Connect customer?</h2><p>Tell us what your business sells and who you want to meet. We’ll use the pilot to prove the workflow before expanding it.</p><ul><li>Focused ideal-customer profile</li><li>Clear qualification rules</li><li>Automated outreach and follow-up</li><li>Qualified appointment handoff</li></ul></div>
      <form className={styles.form} method="post" action="/api/public/connect-interest">
        {submitted && <div className={styles.success}>Thanks. Your pilot request has been recorded.</div>}
        {error && <div className={styles.error}>Please enter your name, company, and a valid work email.</div>}
        <div className={styles.formRow}><label>Your name<input name="name" autoComplete="name" maxLength={120} required/></label><label>Work email<input name="email" type="email" autoComplete="email" maxLength={200} required/></label></div>
        <div className={styles.formRow}><label>Company<input name="company" autoComplete="organization" maxLength={180} required/></label><label>Industry<input name="industry" placeholder="e.g. Commercial cleaning" maxLength={120}/></label></div>
        <div className={styles.formRow}><label>Service area<input name="serviceArea" placeholder="City, metro, or region" maxLength={180}/></label><label>Website<input name="website" type="url" placeholder="https://" maxLength={300}/></label></div>
        <label>Who would you like ArborLine Connect to put you in front of?<textarea name="notes" rows={4} maxLength={1200} placeholder="Example: Medical offices and professional buildings with 10,000+ sq. ft. within 30 miles."/></label>
        <label className={styles.honeypot} aria-hidden="true">Leave this empty<input name="website_url" tabIndex={-1} autoComplete="off"/></label>
        <button type="submit">Request pilot access</button><small>Submitting this form does not enroll you in a paid plan. Pilot availability is limited while the system is being validated.</small>
      </form>
    </section>

    <footer className={styles.footer}><div className={styles.brand}><img src="/brand/arborline-badge.png" alt="" width={42} height={42}/><span>Arbor<span>Line</span> <b>Connect</b></span></div><p>Connecting the right businesses to the right opportunities.</p><a href="/login">Secure sign in</a></footer>
  </main>;
}
