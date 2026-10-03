import { getPool } from "@/lib/db";

type ContentMetrics = {
  prospects: number;
  qualified: number;
  verified: number;
  signals: number;
  replies: number;
  handoffs: number;
};

type GenerateFreshPersonalDraftOptions = {
  source?: string;
  now?: Date;
  maxOpenDrafts?: number;
};

function chicagoDateKey(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const themes = [
  {
    key: "quality-over-volume",
    topic: "The outbound number I care about",
    render: (m: ContentMetrics) =>
      `I keep coming back to one thing while building ArborLine Connect: the raw lead count is probably the least interesting number in the system.

Right now the research pipeline has looked at ${m.prospects.toLocaleString()} companies, and ${m.qualified.toLocaleString()} have cleared the current qualification rules.

That gap is useful. It means the system is allowed to say "not a fit."

I would rather automate the rejection of weak prospects than automate more noise.

The goal is not a bigger list. It is a smaller list with a reason for every name on it.`
  },
  {
    key: "verified-not-guessed",
    topic: "Found is not the same as verified",
    render: (m: ContentMetrics) =>
      `One rule I have been strict about while building ArborLine Connect: finding an email address and verifying an email address are two different things.

The system keeps inferred or discovered contact data separate until verification clears it. At the moment, ${m.verified.toLocaleString()} prospect contacts have reached that verified stage.

That extra gate slows down the vanity metric, but it protects the part that actually matters: sending relevant outreach to a real person at a real address.

Automation gets more useful when it is allowed to say "I do not know yet."`
  },
  {
    key: "signals-before-pitches",
    topic: "Research should create the reason to reach out",
    render: (m: ContentMetrics) =>
      `I do not want ArborLine Connect to start with "Who can we email?"

I want it to start with "What do we know, and is there a real reason to reach out?"

The system has ${m.signals.toLocaleString()} market and research signals stored right now. Those signals feed the research layer before anything moves toward outreach.

That order matters.

Signal -> research -> qualification -> verification -> message.

The message should be the last step, not the first.`
  },
  {
    key: "approval-is-a-feature",
    topic: "Why I kept approval gates in the system",
    render: (_m: ContentMetrics) =>
      `I could have built ArborLine Connect so every automated action immediately fires.

I intentionally did not.

Research can run automatically. Qualification can run automatically. Drafting can run automatically. But the channels that represent me or contact a real prospect still have explicit gates.

To me, that is not a limitation. It is part of the product.

The best automation should remove repetitive work without quietly taking over judgment.`
  },
  {
    key: "pipeline-visibility",
    topic: "I want to see where automation stops",
    render: (m: ContentMetrics) =>
      `A lot of automation demos show the happy path.

I am more interested in the stopping points.

ArborLine currently has ${m.qualified.toLocaleString()} qualified companies in the research pipeline and ${m.verified.toLocaleString()} verified prospect contacts. Those numbers are intentionally different because every stage has its own evidence requirement.

If a company is not a fit, stop.
If the decision-maker is unclear, keep researching.
If the email is not verified, do not pretend it is.

A useful system should make uncertainty visible instead of hiding it.`
  },
  {
    key: "building-the-agent",
    topic: "What I actually want an AI outbound agent to do",
    render: (_m: ContentMetrics) =>
      `When I say I am building an outbound agent, I do not mean a bot that blasts the internet.

I mean a system that can handle the repetitive work around a salesperson:

find the right companies,
research the right people,
separate evidence from guesses,
verify the contact path,
prepare a relevant message,
and surface the conversations that deserve human attention.

The part I want automated is the busywork.

The part I want preserved is judgment.`
  },
  {
    key: "handoff-is-the-goal",
    topic: "The real output is not a sent email",
    render: (m: ContentMetrics) => {
      if (m.replies > 0 || m.handoffs > 0) {
        return `A sent email is not the finish line for ArborLine Connect.

The system has processed ${m.replies.toLocaleString()} replies and created ${m.handoffs.toLocaleString()} qualified handoffs so far.

That is the direction I care about: not activity for the sake of activity, but enough context to recognize genuine interest and move it to a human conversation.

Outbound automation should be measured by what it helps a person do next.`;
      }
      return `A sent email is not the finish line for ArborLine Connect.

The finish line is a real conversation with enough context that a person knows what to do next.

That is why I am building reply classification and handoff logic into the same system as research and outreach.

Sending is just a transport step.

The actual product is turning research into a qualified human conversation.`;
    }
  }
] as const;

async function recordEvent(
  clientId: string,
  eventType: string,
  status: "INFO" | "SUCCESS" | "WARNING" | "ERROR",
  summary: string,
  metrics: Record<string, unknown> = {}
) {
  await getPool().query(
    `INSERT INTO connect_agent_events (client_id,agent_key,event_type,status,summary,metrics)
     VALUES ($1,'CONTENT_AGENT',$2,$3,$4,$5::jsonb)`,
    [clientId, eventType, status, summary, JSON.stringify(metrics)]
  );
}

export async function generateFreshPersonalLinkedInDraft(options: GenerateFreshPersonalDraftOptions = {}) {
  const pool = getPool();
  const now = options.now ?? new Date();
  const source = options.source?.trim() || "content_agent";
  const maxOpenDrafts = Math.max(1, Math.min(12, options.maxOpenDrafts ?? 5));

  const clientResult = await pool.query(
    `SELECT c.id,coalesce(s.content_agent_enabled,true) AS content_agent_enabled
     FROM connect_clients c
     LEFT JOIN connect_agent_settings s ON s.client_id=c.id
     WHERE lower(c.company_name)=lower('ArborLine Connect')
     ORDER BY c.created_at
     LIMIT 1`
  );
  const client = clientResult.rows[0];
  if (!client?.id) return { state: "MISSING_CLIENT", created: false };

  const clientId = String(client.id);
  if (client.content_agent_enabled === false) {
    await recordEvent(clientId, "CONTENT_AUTO_SKIPPED", "INFO", "Automatic personal LinkedIn draft generation skipped because the Content Agent is paused.");
    return { state: "PAUSED", created: false };
  }

  const openResult = await pool.query(
    `SELECT count(*)::int AS count
     FROM connect_social_posts
     WHERE client_id=$1 AND author_type='PERSONAL' AND status IN ('DRAFT','APPROVED','SCHEDULED')`,
    [clientId]
  );
  const openDrafts = number(openResult.rows[0]?.count);
  if (openDrafts >= maxOpenDrafts) {
    await recordEvent(
      clientId,
      "CONTENT_AUTO_SKIPPED",
      "INFO",
      `Automatic personal LinkedIn draft generation paused at ${openDrafts} open drafts so the review queue does not pile up.`,
      { open_drafts: openDrafts, max_open_drafts: maxOpenDrafts }
    );
    return { state: "BACKLOG_FULL", created: false, openDrafts };
  }

  const metricsResult = await pool.query(
    `SELECT
       (SELECT count(*) FROM connect_prospects WHERE client_id=$1)::int AS prospects,
       (SELECT count(*) FROM connect_prospects WHERE client_id=$1 AND qualification_status='QUALIFIED')::int AS qualified,
       (SELECT count(DISTINCT prospect_id) FROM connect_contact_candidates WHERE client_id=$1 AND email_status='VERIFIED' AND prospect_id IS NOT NULL)::int AS verified,
       (SELECT count(*) FROM connect_social_signals WHERE client_id=$1)::int AS signals,
       (SELECT count(*) FROM connect_replies WHERE client_id=$1)::int AS replies,
       (SELECT count(*) FROM connect_handoffs WHERE client_id=$1)::int AS handoffs`,
    [clientId]
  );
  const row = metricsResult.rows[0] ?? {};
  const metrics: ContentMetrics = {
    prospects: number(row.prospects),
    qualified: number(row.qualified),
    verified: number(row.verified),
    signals: number(row.signals),
    replies: number(row.replies),
    handoffs: number(row.handoffs)
  };

  const recentResult = await pool.query(
    `SELECT topic
     FROM connect_social_posts
     WHERE client_id=$1 AND author_type='PERSONAL'
     ORDER BY created_at DESC
     LIMIT 10`,
    [clientId]
  );
  const recentTopics = new Set(recentResult.rows.map((item) => String(item.topic || "").trim()).filter(Boolean));

  const dateKey = chicagoDateKey(now);
  const seed = [...dateKey].reduce((total, character) => total + character.charCodeAt(0), 0);
  let selected = themes[seed % themes.length];
  for (let offset = 0; offset < themes.length; offset++) {
    const candidate = themes[(seed + offset) % themes.length];
    if (!recentTopics.has(candidate.topic)) {
      selected = candidate;
      break;
    }
  }

  const contentKey = `auto-personal-${dateKey}-${selected.key}`;
  const body = selected.render(metrics);
  const metadata = {
    generated_by: "CONTENT_AGENT",
    generation_mode: "zero_cost_live_metrics",
    approval_required: true,
    auto_publish: false,
    source,
    generated_on: dateKey,
    metrics_snapshot: metrics
  };

  const inserted = await pool.query(
    `INSERT INTO connect_social_posts
       (client_id,author_type,content_key,topic,body_text,source_signal,metadata)
     VALUES ($1,'PERSONAL',$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (client_id,content_key) DO NOTHING
     RETURNING id,status,topic,body_text,created_at`,
    [clientId, contentKey, selected.topic, body, `content_agent:${selected.key}`, JSON.stringify(metadata)]
  );

  if (!inserted.rows[0]) {
    return { state: "EXISTS", created: false, contentKey, openDrafts };
  }

  await recordEvent(
    clientId,
    "CONTENT_AUTO_DRAFT",
    "SUCCESS",
    `Fresh PERSONAL LinkedIn draft "${selected.topic}" was generated and queued for approval.`,
    { post_id: inserted.rows[0].id, content_key: contentKey, source, metrics_snapshot: metrics }
  );

  return {
    state: "CREATED",
    created: true,
    contentKey,
    openDrafts: openDrafts + 1,
    post: inserted.rows[0],
    metrics
  };
}
