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

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <span className={`${styles.brandLockup} ${compact ? styles.brandLockupCompact : ""}`}>
    <img src="/brand/arborline-connect-mark.svg" alt="" width={compact ? 42 : 54} height={compact ? 42 : 54}/>
    <span className={styles.brandWordmark}>Arbor<span>Line</span> <b>Connect</b></span>
  </span>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ submitted?: string; error?: string }> }) {
  const params = await searchParams;
  const submitted = params.submitted === "1";
  const error = params.error === "invalid";

  return <main className={styles.page}>
    <header className={styles.nav}>
      <a className={styles.brandLink} href="/" aria-label="ArborLine Connect home"><BrandLockup/></a>
      <nav><a href="#how">How it works</a><a href="/sample">Free sample</a><a href="#qualified">Qualified means qualified</a><a href="#pilot">Founding Client</a><a className={styles.signIn} href="/login">Sign in</a></nav>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>AUTOMATED B2B CONNECTIONS</p>
        <h1>Qualified business connections. <span>Automatically.</span></h1>
        <p className={styles.lede}>ArborLine Connect finds the right businesses, starts the conversation, qualifies real interest, and helps put sales opportunities on your calendar.</p>
        <div className={styles.heroActions}><a className={styles.primary} href="/sample">Get 3–5 free prospect matches</a><a className={styles.secondary} href="#pilot">Apply for Founding Client pricing</a><a className={styles.secondary} href="#how">See the workflow</a></div>
        <p className={styles.micro}>Launching first for recurring commercial service businesses. No purchased “lead lists” passed off as appointments.</p>
      </div>
      <div className={styles.brandStage} aria-label="ArborLine Connect brand illustration">
        <div className={`${styles.floatCard} ${styles.floatCardOne}`}><span>01</span><strong>Discover</strong><small>High-fit businesses</small></div>
        <div className={`${styles.floatCard} ${styles.floatCardTwo}`}><span>02</span><strong>Qualify</strong><small>Real buying signals</small></div>
        <div className={styles.stageMark}><img src="/brand/arborline-connect-mark.svg" alt="" width={250} height={190}/><div className={styles.stageGlow}/></div>
        <div className={`${styles.floatCard} ${styles.floatCardThree}`}><span>03</span><strong>Outreach</strong><small>Relevant conversations</small></div>
        <div className={`${styles.floatCard} ${styles.floatCardFour}`}><span>04</span><strong>Book</strong><small>Qualified meetings</small></div>
        <svg className={styles.stageLine} viewBox="0 0 520 330" aria-hidden="true"><path d="M40 242 C118 246 142 188 214 190 C290 192 302 123 374 126 C424 128 449 94 486 68"/><circle cx="40" cy="242" r="5"/><circle cx="214" cy="190" r="5"/><circle cx="374" cy="126" r="5"/><circle cx="486" cy="68" r="5"/></svg>
      </div>
    </section>

    <section className={styles.capabilityGrid}>{capabilities.map(([title, text]) => <article key={title}><div className={styles.capabilityIcon}>↗</div><h2>{title}</h2><p>{text}</p></article>)}</section>

    <section className={styles.brandBanner} aria-label="ArborLine Connect brand banner">
      <div className={styles.bannerCopy}><p className={styles.kicker}>TRY THE MATCHING ENGINE FIRST</p><h2>Give ArborLine your ideal customer. See a small sample before you commit.</h2><p>Use the free prospect sample to show us your market, geography, and decision makers. We’ll prepare 3–5 matching businesses so you can evaluate fit before becoming a client.</p><div className={styles.heroActions}><a className={styles.primary} href="/sample">Request a free prospect sample</a></div></div>
      <div className={styles.bannerGraphic}>
        <img src="/brand/arborline-connect-mark.svg" alt="" width={190} height={145}/>
        <div className={styles.bannerNode}><span>DEFINE</span><small>your ideal customer</small></div>
        <div className={styles.bannerNode}><span>MATCH</span><small>3–5 businesses</small></div>
        <div className={styles.bannerNode}><span>DECIDE</span><small>if ArborLine fits</small></div>
      </div>
    </section>

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
      <div className={styles.pilotCopy}>
        <p className={styles.kicker}>FOUNDING CLIENT OFFER</p>
        <h2>$750/month. $0 setup. Month-to-month.</h2>
        <p>We’re opening the first 3–5 ArborLine Connect client spots at launch pricing while we build our first case studies. You tell us who you want to reach; ArborLine handles the prospecting workflow and works to create qualified sales conversations.</p>
        <ul><li>Ideal-customer profile built with you</li><li>Qualified company and decision-maker discovery</li><li>Verified work-email enrichment</li><li>Personalized outreach and follow-up</li><li>Interested prospect and appointment handoff</li><li>No long-term contract required</li></ul>
        <p className={styles.micro}>Founding Client pricing is limited to the first 3–5 accepted businesses. Results vary by market, offer, territory, and prospect response; ArborLine does not guarantee a specific number of leads, appointments, or sales.</p>
      </div>
      <form className={styles.form} method="post" action="/api/public/connect-interest">
        {submitted && <div className={styles.success}>Thanks. Your Founding Client application has been recorded.</div>}
        {error && <div className={styles.error}>Please enter your name, company, and a valid work email.</div>}
        <div className={styles.formRow}><label>Your name<input name="name" autoComplete="name" maxLength={120} required/></label><label>Work email<input name="email" type="email" autoComplete="email" maxLength={200} required/></label></div>
        <div className={styles.formRow}><label>Company<input name="company" autoComplete="organization" maxLength={180} required/></label><label>Industry<input name="industry" placeholder="e.g. Commercial cleaning" maxLength={120}/></label></div>
        <div className={styles.formRow}><label>Service area<input name="serviceArea" placeholder="City, metro, state, or nationwide" maxLength={180}/></label><label>Website<input name="website" type="url" placeholder="https://" maxLength={300}/></label></div>
        <label>Who would you like ArborLine Connect to put you in front of?<textarea name="notes" rows={4} maxLength={1200} placeholder="Example: Medical offices and professional buildings with 10,000+ sq. ft. within 30 miles."/></label>
        <label className={styles.honeypot} aria-hidden="true">Leave this empty<input name="website_url" tabIndex={-1} autoComplete="off"/></label>
        <button type="submit">Apply for Founding Client pricing</button><small>Applying does not enroll or charge you. Accepted clients receive the $750/month, $0 setup, month-to-month Founding Client offer before payment.</small>
      </form>
    </section>

    <footer className={styles.footer}><BrandLockup compact/><p>Connecting the right businesses to the right opportunities.</p><a href="/login">Secure sign in</a></footer>
  </main>;
}
