import styles from "./connect.module.css";

const workflow = [
  ["01", "Tell us the customers you want", "Define the industries, geography, account size, service profile, and decision makers that make a customer worth pursuing."],
  ["02", "We build the target market", "ArborLine finds businesses that fit those rules, verifies service fit, and identifies the people most likely to influence the buying decision."],
  ["03", "We start and manage the outreach", "Relevant outreach and follow-up move through verification, approval, suppression, and reply checks before anything is sent."],
  ["04", "You get the conversations that matter", "Interested prospects are qualified against your rules and handed off with the context you need for a call, estimate, or walkthrough."],
] as const;

const capabilities = [
  ["Build your target market", "Find businesses that look like the commercial accounts you actually want to win."],
  ["Reach the right buyer", "Identify real decision-makers and verify work emails before outreach moves forward."],
  ["Handle the follow-up", "Keep the conversation moving without asking your team to spend hours building lists and chasing replies."],
  ["Hand off real interest", "Separate genuine opportunities from wrong contacts, objections, opt-outs, and noise."],
] as const;

const launchTargets = ["Medical offices", "Professional buildings", "Property management", "Industrial & warehouse", "Multi-location businesses", "Local commercial accounts"];

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
      <nav><a href="#how">How it works</a><a href="/sample">Free sample</a><a href="#control">How we protect your reputation</a><a href="#pilot">Founding Client</a><a className={styles.signIn} href="/login">Sign in</a></nav>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>MANAGED CUSTOMER ACQUISITION FOR COMMERCIAL CLEANING</p>
        <h1>Get more commercial customers. <span>Without hiring another salesperson.</span></h1>
        <p className={styles.lede}>ArborLine finds businesses that fit your ideal customer, identifies the right decision-makers, handles personalized outreach and follow-up, and hands you the people who actually want to talk.</p>
        <div className={styles.heroActions}><a className={styles.primary} href="/sample">See 5 companies we’d target for you</a><a className={styles.secondary} href="#how">See how it works</a><a className={styles.secondary} href="#pilot">Founding Client offer</a></div>
        <p className={styles.micro}>Human-reviewed outreach · Verified work emails · Targeting built around your business · Month-to-month</p>
      </div>
      <div className={styles.brandStage} aria-label="ArborLine Connect customer acquisition workflow">
        <div className={`${styles.floatCard} ${styles.floatCardOne}`}><span>01</span><strong>Target</strong><small>Accounts worth winning</small></div>
        <div className={`${styles.floatCard} ${styles.floatCardTwo}`}><span>02</span><strong>Verify</strong><small>Company + buyer fit</small></div>
        <div className={styles.stageMark}><img src="/brand/arborline-connect-mark.svg" alt="" width={250} height={190}/><div className={styles.stageGlow}/></div>
        <div className={`${styles.floatCard} ${styles.floatCardThree}`}><span>03</span><strong>Reach</strong><small>Relevant outreach</small></div>
        <div className={`${styles.floatCard} ${styles.floatCardFour}`}><span>04</span><strong>Connect</strong><small>Real sales interest</small></div>
        <svg className={styles.stageLine} viewBox="0 0 520 330" aria-hidden="true"><path d="M40 242 C118 246 142 188 214 190 C290 192 302 123 374 126 C424 128 449 94 486 68"/><circle cx="40" cy="242" r="5"/><circle cx="214" cy="190" r="5"/><circle cx="374" cy="126" r="5"/><circle cx="486" cy="68" r="5"/></svg>
      </div>
    </section>

    <section className={styles.capabilityGrid}>{capabilities.map(([title, text]) => <article key={title}><div className={styles.capabilityIcon}>↗</div><h2>{title}</h2><p>{text}</p></article>)}</section>

    <section className={styles.brandBanner} aria-label="Free ArborLine prospect sample">
      <div className={styles.bannerCopy}><p className={styles.kicker}>SEE THE WORK BEFORE YOU BUY</p><h2>Show us your ideal customer. We’ll show you 3–5 businesses we would actually pursue.</h2><p>No demo call required. Tell us your service area and the kinds of commercial accounts you want. We’ll prepare a small matched sample so you can judge ArborLine by the quality of the work first.</p><div className={styles.heroActions}><a className={styles.primary} href="/sample">Get my free prospect sample</a></div></div>
      <div className={styles.bannerGraphic}>
        <img src="/brand/arborline-connect-mark.svg" alt="" width={190} height={145}/>
        <div className={styles.bannerNode}><span>DEFINE</span><small>your best customer</small></div>
        <div className={styles.bannerNode}><span>MATCH</span><small>3–5 real businesses</small></div>
        <div className={styles.bannerNode}><span>REVIEW</span><small>the fit before paying</small></div>
      </div>
    </section>

    <section className={styles.workflow} id="how">
      <div className={styles.sectionIntro}><p className={styles.kicker}>DONE-WITH-YOU TARGETING. DONE-FOR-YOU PROSPECTING.</p><h2>From “we need more accounts” to a real sales conversation.</h2><p>You define what a good customer looks like. ArborLine handles the repetitive research, verification, outreach, follow-up, and reply sorting behind the scenes.</p></div>
      <div className={styles.steps}>{workflow.map(([number,title,text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    </section>

    <section className={styles.qualified} id="qualified">
      <div><p className={styles.kicker}>WHAT COUNTS AS AN OPPORTUNITY</p><h2>A contact is not a lead. A reply is not automatically an opportunity.</h2><p>ArborLine is built to move past generic lead lists. A handoff should fit your territory and service profile, involve a real buyer or influencer, and contain a legitimate reason for your team to continue the conversation.</p></div>
      <div className={styles.criteria}>
        <div><span>01</span><strong>Right company</strong><p>Matches the geography, account type, and service criteria you set.</p></div>
        <div><span>02</span><strong>Right person</strong><p>A real decision-maker or someone directly involved in buying the service.</p></div>
        <div><span>03</span><strong>Real interest</strong><p>A genuine response, need, timing signal, or request for the next step.</p></div>
        <div><span>04</span><strong>Useful context</strong><p>Your team sees what happened and why the opportunity is worth pursuing.</p></div>
      </div>
    </section>

    <section className={styles.qualified} id="control">
      <div><p className={styles.kicker}>YOUR REPUTATION STAYS UNDER CONTROL</p><h2>Managed outreach should not mean blind blasting.</h2><p>ArborLine is designed with quality controls around the part most outbound systems rush: who gets contacted, whether the email is credible, and whether a reply or opt-out should stop the sequence.</p></div>
      <div className={styles.criteria}>
        <div><span>01</span><strong>Service fit checked</strong><p>Public business records alone do not count as proof that a company belongs in your campaign.</p></div>
        <div><span>02</span><strong>People and emails verified</strong><p>Outreach is gated on a credible person identity and a verified work-email path.</p></div>
        <div><span>03</span><strong>Reviewed before sending</strong><p>Messages pass approval, qualification, suppression, and recipient checks before entering a live send queue.</p></div>
        <div><span>04</span><strong>Replies and opt-outs respected</strong><p>Replies, suppressions, bounces, complaints, and opt-outs are designed to stop inappropriate follow-up.</p></div>
      </div>
    </section>

    <section className={styles.markets}>
      <div className={styles.sectionIntro}><p className={styles.kicker}>LAUNCH MARKET: COMMERCIAL CLEANING</p><h2>We’re starting where one new recurring account can matter.</h2><p>ArborLine’s technology can support multiple service industries, but the launch go-to-market is intentionally focused. Commercial cleaning gives us a clear buyer, clear territory, and a clear outcome: help cleaning companies get in front of more organizations they would genuinely want as recurring customers.</p></div>
      <div className={styles.marketList}>{launchTargets.map((market) => <span key={market}>{market}</span>)}</div>
    </section>

    <section className={styles.pilot} id="pilot">
      <div className={styles.pilotCopy}>
        <p className={styles.kicker}>FOUNDING CLIENT · COMMERCIAL CLEANING</p>
        <h2>$750/month. $0 setup. Month-to-month.</h2>
        <p>We’re opening the first 3–5 ArborLine Connect client spots at launch pricing while we build our first case studies. You tell us the commercial accounts you want; ArborLine runs the prospecting workflow and works to create qualified sales conversations around that target.</p>
        <ul><li>Ideal-customer profile built with you</li><li>Qualified company and decision-maker discovery</li><li>Verified work-email enrichment</li><li>Personalized outreach and follow-up</li><li>Reply qualification and opportunity handoff</li><li>Customer portal with targeting, conversations, and outcomes</li><li>No long-term contract required</li></ul>
        <p className={styles.micro}>Founding Client pricing is limited to the first 3–5 accepted businesses. Results vary by market, offer, territory, and prospect response; ArborLine does not guarantee a specific number of leads, appointments, or sales.</p>
      </div>
      <form className={styles.form} method="post" action="/api/public/connect-interest">
        {submitted && <div className={styles.success}>Thanks. Your Founding Client application has been recorded.</div>}
        {error && <div className={styles.error}>Please enter your name, company, and a valid work email.</div>}
        <div className={styles.formRow}><label>Your name<input name="name" autoComplete="name" maxLength={120} required/></label><label>Work email<input name="email" type="email" autoComplete="email" maxLength={200} required/></label></div>
        <div className={styles.formRow}><label>Company<input name="company" autoComplete="organization" maxLength={180} required/></label><label>Industry<input name="industry" placeholder="e.g. Commercial cleaning" maxLength={120}/></label></div>
        <div className={styles.formRow}><label>Service area<input name="serviceArea" placeholder="City, metro, or service radius" maxLength={180}/></label><label>Website<input name="website" type="url" placeholder="https://" maxLength={300}/></label></div>
        <label>What kind of commercial customer do you want more of?<textarea name="notes" rows={4} maxLength={1200} placeholder="Example: Medical offices and professional buildings with 10,000+ sq. ft. within 30 miles."/></label>
        <label className={styles.honeypot} aria-hidden="true">Leave this empty<input name="website_url" tabIndex={-1} autoComplete="off"/></label>
        <button type="submit">Apply for Founding Client pricing</button><small>Applying does not enroll or charge you. Accepted clients receive the $750/month, $0 setup, month-to-month Founding Client offer before payment.</small>
      </form>
    </section>

    <footer className={styles.footer}><BrandLockup compact/><p>Managed customer acquisition for commercial service businesses.</p><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data-practices">Data practices</a><a href="/contact">Contact</a><a href="/login">Secure sign in</a></footer>
  </main>;
}
