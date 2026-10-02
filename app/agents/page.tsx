import { AppShell } from "../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getConnectWorkerSummary } from "@/lib/connect-workers";
import {
  approveSocialPost,
  cancelSocialPost,
  generateStarterContentBatch,
  returnSocialPostToDraft,
  toggleAgent
} from "./actions";
import styles from "./agents.module.css";

export const dynamic = "force-dynamic";

type SocialPost = {
  id: string;
  author_type: "COMPANY" | "PERSONAL";
  status: string;
  topic: string;
  body_text: string;
  scheduled_for: string | null;
  created_at: string;
};

type AgentEvent = {
  id: string;
  agent_key: string;
  event_type: string;
  status: string;
  summary: string;
  created_at: string;
};

function statusClass(status: string) {
  if (["ACTIVE","READY","SUCCESS","PUBLISHED"].includes(status)) return styles.good;
  if (["CONNECT","STAGED","APPROVAL","DRAFT","WARNING"].includes(status)) return styles.warn;
  return styles.mutedStatus;
}

function AgentCard({
  number,
  title,
  status,
  description,
  metric,
  metricLabel,
  enabled,
  agentKey
}: {
  number: string;
  title: string;
  status: string;
  description: string;
  metric: string | number;
  metricLabel: string;
  enabled?: boolean;
  agentKey?: string;
}) {
  return <article className={styles.agentCard}>
    <div className={styles.agentHead}>
      <span className={styles.agentNumber}>{number}</span>
      <div className={styles.grow}><strong>{title}</strong><p>{description}</p></div>
      <span className={statusClass(status)}>{status}</span>
    </div>
    <div className={styles.agentMetric}><b>{metric}</b><span>{metricLabel}</span></div>
    {agentKey && typeof enabled === "boolean" ? <form action={toggleAgent}>
      <input type="hidden" name="agentKey" value={agentKey}/>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"}/>
      <button className={styles.smallButton} type="submit">{enabled ? "Pause agent" : "Enable agent"}</button>
    </form> : null}
  </article>;
}

export default async function AgentsPage() {
  await requirePageRole(["STAFF"]);
  const pool = getPool();

  const clientResult = await pool.query(
    "SELECT id,company_name FROM connect_clients WHERE lower(company_name)=lower('ArborLine Connect') ORDER BY created_at LIMIT 1"
  );
  const client = clientResult.rows[0] ?? null;

  if (!client) {
    return <AppShell active="Agents"><header><div><p className="eyebrow">AI OUTREACH COMMAND CENTER</p><h1>Agents</h1></div></header><section className="panel"><p>Initialize the ArborLine Connect internal growth campaign first.</p></section></AppShell>;
  }

  const clientId = client.id as string;

  const [
    prospectResult,
    verifiedResult,
    outreachResult,
    replyResult,
    handoffResult,
    socialResult,
    signalResult,
    linkedinActionResult,
    settingsResult,
    postsResult,
    eventsResult
  ] = await Promise.all([
    pool.query(
      "SELECT count(*)::int AS prospects, count(*) FILTER (WHERE qualification_status='QUALIFIED')::int AS qualified, count(*) FILTER (WHERE outreach_status='CONTACTED')::int AS contacted FROM connect_prospects WHERE client_id=$1",
      [clientId]
    ),
    pool.query(
      "SELECT count(DISTINCT prospect_id)::int AS verified FROM connect_contact_candidates WHERE client_id=$1 AND email_status='VERIFIED' AND prospect_id IS NOT NULL",
      [clientId]
    ),
    pool.query(
      "SELECT count(*) FILTER (WHERE status='DRAFT')::int AS drafts, count(*) FILTER (WHERE status='QUEUED')::int AS queued, count(*) FILTER (WHERE status='SENT')::int AS sent FROM connect_outreach_messages WHERE client_id=$1",
      [clientId]
    ),
    pool.query(
      "SELECT count(*)::int AS replies, count(*) FILTER (WHERE classification='INTERESTED')::int AS interested FROM connect_replies WHERE client_id=$1",
      [clientId]
    ),
    pool.query("SELECT count(*)::int AS handoffs FROM connect_handoffs WHERE client_id=$1", [clientId]),
    pool.query(
      "SELECT count(*) FILTER (WHERE status='DRAFT')::int AS drafts, count(*) FILTER (WHERE status='APPROVED')::int AS approved, count(*) FILTER (WHERE status='SCHEDULED')::int AS scheduled, count(*) FILTER (WHERE status='PUBLISHED')::int AS published FROM connect_social_posts WHERE client_id=$1",
      [clientId]
    ),
    pool.query(
      "SELECT count(*)::int AS total, count(*) FILTER (WHERE status='NEW')::int AS fresh, count(*) FILTER (WHERE status='QUEUED')::int AS queued FROM connect_social_signals WHERE client_id=$1",
      [clientId]
    ),
    pool.query(
      "SELECT count(*) FILTER (WHERE status='READY')::int AS ready, count(*) FILTER (WHERE status='DONE')::int AS done FROM connect_linkedin_actions WHERE client_id=$1",
      [clientId]
    ),
    pool.query("SELECT * FROM connect_agent_settings WHERE client_id=$1", [clientId]),
    pool.query(
      "SELECT id,author_type,status,topic,body_text,scheduled_for,created_at FROM connect_social_posts WHERE client_id=$1 AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 12",
      [clientId]
    ),
    pool.query(
      "SELECT id,agent_key,event_type,status,summary,created_at FROM connect_agent_events WHERE client_id=$1 ORDER BY created_at DESC LIMIT 12",
      [clientId]
    )
  ]);

  const prospects = prospectResult.rows[0] ?? {};
  const verified = verifiedResult.rows[0]?.verified ?? 0;
  const outreach = outreachResult.rows[0] ?? {};
  const replies = replyResult.rows[0] ?? {};
  const handoffs = handoffResult.rows[0]?.handoffs ?? 0;
  const social = socialResult.rows[0] ?? {};
  const signals = signalResult.rows[0] ?? {};
  const linkedinActions = linkedinActionResult.rows[0] ?? {};
  const settings = settingsResult.rows[0] ?? {
    content_agent_enabled: true,
    market_watch_enabled: true,
    research_agent_enabled: true,
    enrichment_agent_enabled: true,
    outreach_agent_enabled: true,
    reply_agent_enabled: true,
    linkedin_company_publish_mode: "APPROVAL",
    linkedin_personal_publish_mode: "APPROVAL",
    linkedin_outreach_mode: "APPROVAL",
    email_outreach_mode: "APPROVAL"
  };
  const posts = postsResult.rows as SocialPost[];
  const events = eventsResult.rows as AgentEvent[];

  let workers = { queued: 0, running: 0, retrying: 0, succeeded: 0, blocked: 0, failed: 0, latest_worker: null as string | null, latest_status: null as string | null };
  try {
    workers = { ...workers, ...(await getConnectWorkerSummary(clientId)) };
  } catch {
    // The dashboard stays available even if the worker summary is temporarily unavailable.
  }

  const linkedinAppConfigured = Boolean(
    process.env.LINKEDIN_CLIENT_ID &&
    process.env.LINKEDIN_CLIENT_SECRET &&
    process.env.LINKEDIN_PERSON_URN &&
    process.env.LINKEDIN_ORGANIZATION_URN
  );
  const linkedinPublishingEnabled = linkedinAppConfigured && process.env.LINKEDIN_PUBLISHING_ENABLED === "true";
  const liveEmailEnabled = process.env.CONNECT_LIVE_OUTREACH_ENABLED === "true";
  const autosendEnabled = process.env.CONNECT_AUTOSEND_ENABLED === "true";

  return <AppShell active="Agents">
    <header className={styles.header}>
      <div>
        <p className="eyebrow">ARBORLINE_ / AI OUTREACH COMMAND CENTER</p>
        <h1>Agents</h1>
        <p className="muted">Research, qualification, content, outreach, and reply handling in one operating view. All numbers below come from the live ArborLine database.</p>
      </div>
      <div className={styles.liveBadge}><span/> SYSTEM ONLINE</div>
    </header>

    <section className="grid stats">
      <article className="card"><p>Prospects</p><h2>{prospects.prospects ?? 0}</h2><small>Companies in ArborLine's current growth pipeline</small></article>
      <article className="card"><p>Qualified</p><h2>{prospects.qualified ?? 0}</h2><small>Passed current ICP rules</small></article>
      <article className="card"><p>Verified contacts</p><h2>{verified}</h2><small>Mailbox-verified prospect contacts</small></article>
      <article className="card"><p>Replies</p><h2>{replies.replies ?? 0}</h2><small>{replies.interested ?? 0} currently classified interested</small></article>
    </section>

    <section className={styles.commandGrid} data-page-section-persistent="true">
      <article className={styles.commandColumn}>
        <div className={styles.columnTitle}><span>01</span><div><strong>WATCH THE MARKET</strong><small>Signals + content intelligence</small></div></div>
        <div className={styles.bigMetric}><b>{signals.total ?? 0}</b><span>social / market signals stored</span></div>
        <div className={styles.miniRow}><span>Fresh signals</span><b>{signals.fresh ?? 0}</b></div>
        <div className={styles.miniRow}><span>Queued to research</span><b>{signals.queued ?? 0}</b></div>
        <div className={styles.miniRow}><span>Company posts drafted</span><b>{posts.filter((p) => p.author_type === "COMPANY").length}</b></div>
        <div className={styles.connectorNote}>{linkedinAppConfigured ? "LinkedIn app credentials detected." : "LinkedIn authorization is the remaining connector step for Page/member publishing and owned-engagement ingestion."}</div>
      </article>

      <article className={styles.commandColumn}>
        <div className={styles.columnTitle}><span>02</span><div><strong>PULL + SCORE PROSPECTS</strong><small>Existing ArborLine research engine</small></div></div>
        <div className={styles.bigMetric}><b>{prospects.qualified ?? 0}</b><span>ICP matches</span></div>
        <div className={styles.miniRow}><span>Verified contacts</span><b>{verified}</b></div>
        <div className={styles.miniRow}><span>Worker queue</span><b>{workers.queued} queued · {workers.running} running</b></div>
        <div className={styles.miniRow}><span>Worker successes</span><b>{workers.succeeded}</b></div>
        <div className={styles.connectorNote}>Guessed or inferred addresses stay separate from mailbox-verified contacts.</div>
      </article>

      <article className={styles.commandColumn}>
        <div className={styles.columnTitle}><span>03</span><div><strong>STAGE THE OUTBOUND</strong><small>Email + LinkedIn action queue</small></div></div>
        <div className={styles.bigMetric}><b>{(outreach.drafts ?? 0) + (social.drafts ?? 0)}</b><span>drafts awaiting review</span></div>
        <div className={styles.miniRow}><span>Email queued</span><b>{outreach.queued ?? 0}</b></div>
        <div className={styles.miniRow}><span>LinkedIn actions ready</span><b>{linkedinActions.ready ?? 0}</b></div>
        <div className={styles.miniRow}><span>Qualified handoffs</span><b>{handoffs}</b></div>
        <div className={styles.connectorNote}>LinkedIn cold outreach remains an approval/action queue instead of an unauthorized browser bot.</div>
      </article>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">AGENT FLEET</p><h3>What is running, staged, or waiting on a connector</h3></div><span className="status">{workers.failed + workers.blocked + workers.retrying} worker items need attention</span></div>
      <div className={styles.agentGrid}>
        <AgentCard number="01" title="Content Agent" status={settings.content_agent_enabled ? "ACTIVE" : "PAUSED"} description="Creates separate company-page and founder/personal LinkedIn drafts." metric={(social.drafts ?? 0) + (social.approved ?? 0)} metricLabel="posts in review pipeline" enabled={settings.content_agent_enabled} agentKey="CONTENT_AGENT"/>
        <AgentCard number="02" title="Market Watch" status={settings.market_watch_enabled ? (linkedinAppConfigured ? "READY" : "STAGED") : "PAUSED"} description="Stores public buying signals now; owned LinkedIn engagement can plug in after authorization." metric={signals.total ?? 0} metricLabel="signals captured" enabled={settings.market_watch_enabled} agentKey="MARKET_WATCH"/>
        <AgentCard number="03" title="Research Agent" status={settings.research_agent_enabled ? "ACTIVE" : "PAUSED"} description="Uses the existing company and decision-maker research pipeline." metric={prospects.prospects ?? 0} metricLabel="prospects in database" enabled={settings.research_agent_enabled} agentKey="RESEARCH_AGENT"/>
        <AgentCard number="04" title="Enrichment + Verification" status={settings.enrichment_agent_enabled ? "ACTIVE" : "PAUSED"} description="Keeps published/inferred candidates separate until verification promotes a usable address." metric={verified} metricLabel="verified contacts" enabled={settings.enrichment_agent_enabled} agentKey="ENRICHMENT_AGENT"/>
        <AgentCard number="05" title="Outreach Agent" status={settings.outreach_agent_enabled ? "APPROVAL" : "PAUSED"} description="Prepares personalized email and LinkedIn actions; delivery remains behind channel gates." metric={(outreach.drafts ?? 0) + (outreach.queued ?? 0)} metricLabel="email drafts + queued" enabled={settings.outreach_agent_enabled} agentKey="OUTREACH_AGENT"/>
        <AgentCard number="06" title="Reply Agent" status={settings.reply_agent_enabled ? "ACTIVE" : "PAUSED"} description="Classifies replies and hands genuine interest into the existing handoff workflow." metric={replies.replies ?? 0} metricLabel="replies processed" enabled={settings.reply_agent_enabled} agentKey="REPLY_AGENT"/>
        <AgentCard number="07" title="LinkedIn Publisher" status={linkedinPublishingEnabled ? "ACTIVE" : linkedinAppConfigured ? "READY" : "CONNECT"} description="Publishes approved company/member posts only through authorized LinkedIn access." metric={social.published ?? 0} metricLabel="LinkedIn posts published"/>
      </div>
    </section>

    <section className="panel">
      <div className="panelHead">
        <div><p className="eyebrow">CONTENT AGENT</p><h3>LinkedIn post review queue</h3></div>
        <div className={styles.inlineActions}><span className="status">{social.drafts ?? 0} draft · {social.approved ?? 0} approved · {social.published ?? 0} published</span><form action={generateStarterContentBatch}><button type="submit">Generate starter batch</button></form></div>
      </div>
      <p className="muted">Company Page and personal-profile copy are stored separately. Approving a post does not publish it until the LinkedIn connector and publishing gate are enabled.</p>
      <div className={styles.postGrid}>
        {posts.length ? posts.map((post) => <article className={styles.postCard} key={post.id}>
          <div className={styles.postMeta}><span>{post.author_type === "COMPANY" ? "ARBORLINE COMPANY" : "PERSONAL PROFILE"}</span><span className={statusClass(post.status)}>{post.status}</span></div>
          <h4>{post.topic}</h4>
          <p>{post.body_text}</p>
          <div className={styles.postActions}>
            {post.status !== "APPROVED" ? <form action={approveSocialPost}><input type="hidden" name="postId" value={post.id}/><button type="submit">Approve</button></form> : <form action={returnSocialPostToDraft}><input type="hidden" name="postId" value={post.id}/><button type="submit">Return to draft</button></form>}
            <form action={cancelSocialPost}><input type="hidden" name="postId" value={post.id}/><button className={styles.ghostButton} type="submit">Cancel</button></form>
          </div>
        </article>) : <div className={styles.emptyState}><strong>No social drafts yet.</strong><span>Generate the starter batch to create separate Company Page and personal-profile posts at $0 cost.</span></div>}
      </div>
    </section>

    <section className="split">
      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">CHANNEL GATES</p><h3>Nothing sends just because an agent wrote it</h3></div></div>
        <div className="health">
          <div><span>LinkedIn app</span><b>{linkedinAppConfigured ? "Configured" : "Credentials needed"}</b></div>
          <div><span>LinkedIn publishing</span><b>{linkedinPublishingEnabled ? "Enabled" : "Locked"}</b></div>
          <div><span>Company Page mode</span><b>{settings.linkedin_company_publish_mode}</b></div>
          <div><span>Personal profile mode</span><b>{settings.linkedin_personal_publish_mode}</b></div>
          <div><span>LinkedIn cold outreach</span><b>{settings.linkedin_outreach_mode}</b></div>
          <div><span>Email live delivery</span><b>{liveEmailEnabled ? "Enabled" : "Locked"}</b></div>
          <div><span>Email autosend</span><b>{autosendEnabled ? "Enabled" : "Locked"}</b></div>
          <div><span>Email mode</span><b>{settings.email_outreach_mode}</b></div>
        </div>
      </article>

      <article className="panel">
        <div className="panelHead"><div><p className="eyebrow">LATEST AGENT ACTIVITY</p><h3>Audit trail</h3></div></div>
        <div className={styles.eventList}>
          {events.length ? events.map((event) => <div className={styles.event} key={event.id}><span className={statusClass(event.status)}>{event.status}</span><div><strong>{event.agent_key}</strong><p>{event.summary}</p><small>{new Date(event.created_at).toLocaleString()}</small></div></div>) : <div className={styles.emptyState}><span>Agent events will appear here as the new social/content workflow runs.</span></div>}
        </div>
      </article>
    </section>
  </AppShell>;
}
