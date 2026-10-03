"use server";

import { revalidatePath } from "next/cache";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { decryptLinkedInToken, publishLinkedInTextPost } from "@/lib/linkedin";
import { generateFreshPersonalLinkedInDraft } from "@/lib/connect-content-agent";

async function getArborLineClientId() {
  const result = await getPool().query(
    "SELECT id FROM connect_clients WHERE lower(company_name)=lower('ArborLine Connect') ORDER BY created_at LIMIT 1"
  );
  const id = result.rows[0]?.id as string | undefined;
  if (!id) throw new Error("ArborLine Connect internal client is not initialized.");
  return id;
}

async function recordAgentEvent(clientId: string, agentKey: string, eventType: string, status: "INFO" | "SUCCESS" | "WARNING" | "ERROR", summary: string, metrics: Record<string, unknown> = {}) {
  await getPool().query(
    "INSERT INTO connect_agent_events (client_id,agent_key,event_type,status,summary,metrics) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [clientId, agentKey, eventType, status, summary, JSON.stringify(metrics)]
  );
}

const starterPosts = [
  {
    key: "starter-company-01",
    author: "COMPANY",
    topic: "Why lead lists fail",
    body: "Most lead lists fail before the first email is ever sent.\n\nThe problem is not usually volume. It is fit.\n\nArborLine Connect is built to research the company, identify the right decision-maker, verify the contact path, and keep outreach behind review and suppression controls before a message moves forward.\n\nFor commercial service businesses, fewer well-matched conversations can be worth far more than thousands of random contacts."
  },
  {
    key: "starter-company-02",
    author: "COMPANY",
    topic: "A contact is not a lead",
    body: "A contact is not automatically a lead. A reply is not automatically an opportunity.\n\nWe treat a real opportunity as the combination of the right company, the right person, genuine interest, and enough context for the sales team to know what to do next.\n\nThat distinction is the reason ArborLine Connect is being built around qualification and evidence instead of list size."
  },
  {
    key: "starter-company-03",
    author: "COMPANY",
    topic: "Research before outreach",
    body: "Before outreach, we want to know three things: Is this company actually a fit? Is this the right person? Is the contact information credible?\n\nArborLine Connect keeps public research, email verification, qualification, suppression, and human review as separate gates.\n\nThe goal is simple: make outbound feel researched instead of automated."
  },
  {
    key: "starter-personal-01",
    author: "PERSONAL",
    topic: "Why I built ArborLine",
    body: "I started building ArborLine Connect because I did not want another system that just hands a business a giant spreadsheet of names and calls it lead generation.\n\nI wanted the repetitive work handled automatically: finding companies, researching the people who matter, verifying contact information, preparing relevant outreach, and sorting replies.\n\nThe part I care about most is keeping the quality controls in the loop so automation does not become blind blasting."
  },
  {
    key: "starter-personal-02",
    author: "PERSONAL",
    topic: "Recurring account economics",
    body: "For a recurring-service business, one good commercial account can change the economics of an entire month.\n\nThat is why I would rather have ArborLine research 25 companies that truly match the target than dump 2,500 generic contacts into a sequence.\n\nThe system I am building is designed around fit first, contact quality second, and outreach only after those two things make sense."
  },
  {
    key: "starter-personal-03",
    author: "PERSONAL",
    topic: "Automation with controls",
    body: "The outbound system I do NOT want: scrape thousands of people, guess emails, send the same message to everyone, and hope the domain survives.\n\nThe system I am building: discover, research, qualify, verify, personalize, review, send, classify the reply, and hand off real interest.\n\nAutomation should remove repetitive work without removing judgment."
  }
] as const;

export async function generateStarterContentBatch() {
  await requirePageRole(["STAFF"]);
  const clientId = await getArborLineClientId();
  const pool = getPool();
  let created = 0;

  for (const post of starterPosts) {
    const result = await pool.query(
      "INSERT INTO connect_social_posts (client_id,author_type,content_key,topic,body_text,source_signal,metadata) VALUES ($1,$2,$3,$4,$5,'starter_batch_v1',$6::jsonb) ON CONFLICT (client_id,content_key) DO NOTHING RETURNING id",
      [clientId, post.author, post.key, post.topic, post.body, JSON.stringify({ generated_by: "CONTENT_AGENT", cost_usd: 0 })]
    );
    created += result.rowCount ?? 0;
  }

  await recordAgentEvent(
    clientId,
    "CONTENT_AGENT",
    "CONTENT_BATCH",
    "SUCCESS",
    created > 0 ? "Created the zero-cost starter LinkedIn content batch." : "Starter LinkedIn content batch already exists; duplicate creation was prevented.",
    { created, requested: starterPosts.length }
  );
  revalidatePath("/agents");
}

export async function generateFreshPersonalPost() {
  await requirePageRole(["STAFF"]);
  await generateFreshPersonalLinkedInDraft({
    source: "agents-dashboard",
    maxOpenDrafts: 5
  });
  revalidatePath("/agents");
}

async function updatePostStatus(formData: FormData, status: "DRAFT" | "APPROVED" | "CANCELLED") {
  await requirePageRole(["STAFF"]);
  const clientId = await getArborLineClientId();
  const postId = String(formData.get("postId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return;

  const result = await getPool().query(
    "UPDATE connect_social_posts SET status=$3,updated_at=now() WHERE id=$1 AND client_id=$2 AND status <> 'PUBLISHED' RETURNING topic,author_type",
    [postId, clientId, status]
  );
  if (result.rows[0]) {
    await recordAgentEvent(
      clientId,
      "CONTENT_AGENT",
      "POST_STATUS",
      "INFO",
      result.rows[0].author_type + " post \"" + result.rows[0].topic + "\" moved to " + status + "."
    );
  }
  revalidatePath("/agents");
}

export async function approveSocialPost(formData: FormData) {
  return updatePostStatus(formData, "APPROVED");
}

export async function returnSocialPostToDraft(formData: FormData) {
  return updatePostStatus(formData, "DRAFT");
}

export async function cancelSocialPost(formData: FormData) {
  return updatePostStatus(formData, "CANCELLED");
}

const agentColumns: Record<string, string> = {
  CONTENT_AGENT: "content_agent_enabled",
  MARKET_WATCH: "market_watch_enabled",
  RESEARCH_AGENT: "research_agent_enabled",
  ENRICHMENT_AGENT: "enrichment_agent_enabled",
  OUTREACH_AGENT: "outreach_agent_enabled",
  REPLY_AGENT: "reply_agent_enabled"
};

export async function toggleAgent(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = await getArborLineClientId();
  const key = String(formData.get("agentKey") ?? "");
  const column = agentColumns[key];
  if (!column) return;

  const enabled = String(formData.get("enabled") ?? "") === "true";
  await getPool().query(
    "UPDATE connect_agent_settings SET " + column + "=$2,updated_at=now() WHERE client_id=$1",
    [clientId, enabled]
  );
  await recordAgentEvent(clientId, key, "AGENT_SWITCH", "INFO", key + " " + (enabled ? "enabled." : "paused."));
  revalidatePath("/agents");
}


export async function publishSocialPost(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = await getArborLineClientId();
  const postId = String(formData.get("postId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return;

  if (process.env.LINKEDIN_PUBLISHING_ENABLED !== "true") {
    await recordAgentEvent(clientId, "LINKEDIN_PUBLISHER", "PUBLISH_BLOCKED", "WARNING", "LinkedIn publishing is still locked by the production gate.");
    revalidatePath("/agents");
    return;
  }

  const pool = getPool();
  const postResult = await pool.query(
    "SELECT id,author_type,topic,body_text,status FROM connect_social_posts WHERE id=$1 AND client_id=$2 LIMIT 1",
    [postId, clientId]
  );
  const post = postResult.rows[0];
  if (!post || post.status !== "APPROVED") return;

  const connectionResult = await pool.query(
    "SELECT * FROM connect_linkedin_connections WHERE client_id=$1 AND status='ACTIVE' AND expires_at > now() LIMIT 1",
    [clientId]
  );
  const connection = connectionResult.rows[0];
  if (!connection) {
    await recordAgentEvent(clientId, "LINKEDIN_PUBLISHER", "PUBLISH_BLOCKED", "WARNING", "LinkedIn authorization is missing or expired.");
    revalidatePath("/agents");
    return;
  }

  const authorUrn = post.author_type === "COMPANY" ? connection.organization_urn : connection.member_urn;
  if (!authorUrn) {
    await recordAgentEvent(clientId, "LINKEDIN_PUBLISHER", "PUBLISH_BLOCKED", "WARNING", "The required LinkedIn author URN is not configured.");
    revalidatePath("/agents");
    return;
  }

  try {
    const accessToken = decryptLinkedInToken({
      encrypted: connection.encrypted_access_token,
      iv: connection.token_iv,
      tag: connection.token_tag
    });
    const published = await publishLinkedInTextPost({
      accessToken,
      authorUrn,
      commentary: post.body_text
    });

    await pool.query(
      "UPDATE connect_social_posts SET status='PUBLISHED',published_at=now(),external_post_id=$3,updated_at=now(),metadata=metadata || $4::jsonb WHERE id=$1 AND client_id=$2",
      [postId, clientId, published.id, JSON.stringify({ linkedin_response_status: published.status })]
    );
    await pool.query(
      "UPDATE connect_linkedin_connections SET last_error=NULL,updated_at=now() WHERE client_id=$1",
      [clientId]
    );
    await recordAgentEvent(
      clientId,
      "LINKEDIN_PUBLISHER",
      "POST_PUBLISHED",
      "SUCCESS",
      post.author_type + " LinkedIn post \"" + post.topic + "\" published through the authorized API.",
      { post_id: postId, external_post_id: published.id }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "LinkedIn publish failed.";
    await pool.query(
      "UPDATE connect_social_posts SET status='FAILED',updated_at=now(),metadata=metadata || $3::jsonb WHERE id=$1 AND client_id=$2",
      [postId, clientId, JSON.stringify({ linkedin_last_error: message })]
    );
    await pool.query(
      "UPDATE connect_linkedin_connections SET status=CASE WHEN $2 LIKE '%401%' THEN 'EXPIRED' ELSE status END,last_error=$2,updated_at=now() WHERE client_id=$1",
      [clientId, message]
    );
    await recordAgentEvent(clientId, "LINKEDIN_PUBLISHER", "POST_FAILED", "ERROR", message, { post_id: postId });
  }

  revalidatePath("/agents");
}
