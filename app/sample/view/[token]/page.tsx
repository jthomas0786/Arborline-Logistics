import styles from "../../../connect.module.css";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function externalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 4) : [];
}

function defaultBuyerTitles(industry: string) {
  const value = industry.toLowerCase();
  if (value.includes("staff")) return "Operations Director, Plant Manager, Warehouse Manager, HR Director, Procurement";
  return "Facilities Director, Property Manager, Operations Director, Procurement";
}

function sourceLabel(value: unknown) {
  return String(value || "").toUpperCase() === "OPENSTREETMAP_OVERPASS"
    ? "Public OpenStreetMap business/facility record"
    : "ArborLine source record";
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <span className={`${styles.brandLockup} ${compact ? styles.brandLockupCompact : ""}`}>
    <img src="/brand/arborline-connect-mark.svg" alt="" width={compact ? 42 : 54} height={compact ? 42 : 54}/>
    <span className={styles.brandWordmark}>Arbor<span>Line</span> <b>Connect</b></span>
  </span>;
}

export default async function SharedSamplePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validUuid(token)) return <Unavailable/>;

  const pool = getPool();
  const requestResult = await pool.query(
    `SELECT id,name,company_name,industry,target_customer,service_area,decision_maker_titles,
            sample_email_status,sample_approved_at,sample_email_sent_at
     FROM connect_pilot_interest
     WHERE request_type='FREE_SAMPLE' AND sample_share_token=$1::uuid AND sample_approved_at IS NOT NULL
     LIMIT 1`,
    [token]
  );
  const request = requestResult.rows[0];
  if (!request) return <Unavailable/>;
  const requesterIndustry = String(request.industry || "").trim();
  const likelyBuyer = String(request.decision_maker_titles || "").trim() || defaultBuyerTitles(requesterIndustry);

  const matchesResult = await pool.query(
    `SELECT rank,company_name,website,domain,industry,city,state,country,employee_count,source,source_url,match_score,match_reasons
     FROM connect_free_sample_matches
     WHERE request_id=$1 AND selected=true
     ORDER BY rank
     LIMIT 5`,
    [request.id]
  );

  if (request.sample_email_status === "SENT") {
    await pool.query(
      `UPDATE connect_pilot_interest
       SET sample_viewed_at=COALESCE(sample_viewed_at,now()),sample_view_count=sample_view_count+1,updated_at=now()
       WHERE id=$1 AND request_type='FREE_SAMPLE' AND sample_email_status='SENT'`,
      [request.id]
    );
  }

  return <main className={styles.page}>
    <header className={styles.nav}>
      <a className={styles.brandLink} href="/" aria-label="ArborLine Connect home"><BrandLockup/></a>
      <nav><a href="/#how">How it works</a><a href="/#pilot">Founding Client</a></nav>
    </header>

    <section className={styles.workflow} style={{paddingTop:64,paddingBottom:44}}>
      <div className={styles.sectionIntro}>
        <p className={styles.kicker}>YOUR FREE PROSPECT SAMPLE</p>
        <h2>Prospect matches prepared for {request.company_name}.</h2>
        <p>These companies were selected from the target profile you submitted{requesterIndustry ? ` for your ${requesterIndustry} business` : ""}. This is a small proof of the research and qualification workflow ArborLine Connect can run continuously for your business.</p>
      </div>
    </section>

    <section className={styles.qualified} style={{paddingTop:32,paddingBottom:56}}>
      <div>
        <p className={styles.kicker}>YOUR TARGET</p>
        <h2>What ArborLine matched against.</h2>
        {requesterIndustry ? <p><strong>Your industry:</strong> {requesterIndustry}</p> : null}
        <p><strong>Ideal customer:</strong> {request.target_customer || "Your submitted ideal-customer profile"}</p>
        <p><strong>Geography:</strong> {request.service_area || "Your requested market"}</p>
        <p><strong>Likely buying roles:</strong> {likelyBuyer}</p>
      </div>
      <div className={styles.criteria}>
        {matchesResult.rows.map((match) => {
          const website = externalUrl(match.website || match.domain);
          const evidenceUrl = externalUrl(match.source_url);
          const matchReasons = reasons(match.match_reasons);
          return <div key={`${match.rank}-${match.company_name}`} style={{gridColumn:"1 / -1"}}>
            <span>#{match.rank} · {match.match_score}/100 MATCH</span>
            <strong>{match.company_name}</strong>
            <p>{[match.industry,match.city,match.state,match.employee_count ? `${match.employee_count} employees` : null].filter(Boolean).join(" · ") || "Company details available"}</p>
            <p><strong>Why ArborLine picked it:</strong> {matchReasons.length ? matchReasons.slice(0,2).join(" ") : "The company fits the submitted target profile and geography."}</p>
            <p><strong>Likely buyer:</strong> {likelyBuyer}</p>
            <p><strong>Evidence:</strong> {sourceLabel(match.source)}{evidenceUrl ? <> · <a href={evidenceUrl} target="_blank" rel="noreferrer">View source</a></> : null}</p>
            {website ? <p><a className={styles.secondary} href={website} target="_blank" rel="noreferrer">Visit company website</a></p> : null}
          </div>;
        })}
      </div>
    </section>

    <section className={styles.brandBanner} style={{marginBottom:70}}>
      <div className={styles.bannerCopy}>
        <p className={styles.kicker}>LIKE THE DIRECTION?</p>
        <h2>Turn a 3–5 company sample into an ongoing prospecting system.</h2>
        <p>Founding Clients tell ArborLine who they want to reach. The system handles prospect discovery, decision-maker enrichment, personalized outreach, reply qualification, and qualified handoff{requesterIndustry ? ` for businesses like ${request.company_name} in ${requesterIndustry}` : ""}.</p>
        <div className={styles.heroActions}><a className={styles.primary} href="/#pilot">See Founding Client pricing</a><a className={styles.secondary} href="/sample">Refine your target with another sample</a></div>
      </div>
      <div className={styles.bannerGraphic}>
        <img src="/brand/arborline-connect-mark.svg" alt="" width={190} height={145}/>
        <div className={styles.bannerNode}><span>DISCOVER</span><small>matching businesses</small></div>
        <div className={styles.bannerNode}><span>QUALIFY</span><small>the right accounts</small></div>
        <div className={styles.bannerNode}><span>CONNECT</span><small>create conversations</small></div>
      </div>
    </section>

    <footer className={styles.footer}><BrandLockup compact/><p>Prepared for {request.company_name}{requesterIndustry ? ` · ${requesterIndustry}` : ""}. Prospect data can change; verify current company details before making business decisions.</p><a href="/#pilot">Founding Client</a></footer>
  </main>;
}

function Unavailable() {
  return <main className={styles.page}>
    <header className={styles.nav}><a className={styles.brandLink} href="/"><BrandLockup/></a></header>
    <section className={styles.hero} style={{gridTemplateColumns:"1fr",minHeight:"65vh"}}>
      <div className={styles.heroCopy}><p className={styles.kicker}>ARBORLINE CONNECT</p><h1>This sample link is unavailable.</h1><p className={styles.lede}>The link may have been replaced while the sample was being refined. Request a new sample or contact ArborLine Connect if you need help.</p><div className={styles.heroActions}><a className={styles.primary} href="/sample">Request a free sample</a><a className={styles.secondary} href="/">Back to ArborLine</a></div></div>
    </section>
  </main>;
}
