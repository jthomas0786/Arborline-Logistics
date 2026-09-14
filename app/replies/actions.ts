"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { createConnectHandoffs, type ConnectReplyClassification } from "@/lib/connect-replies";
import { sendRequestedConnectWalkthrough } from "@/lib/connect-walkthrough";

const CLASSIFICATIONS: ConnectReplyClassification[] = [
  "INTERESTED",
  "VIDEO_REQUESTED",
  "OBJECTION",
  "NOT_NOW",
  "WRONG_CONTACT",
  "UNSUBSCRIBE",
  "OUT_OF_OFFICE",
  "UNKNOWN"
];

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function revalidateConnect() {
  revalidatePath("/replies");
  revalidatePath("/campaigns");
  revalidatePath("/prospects");
  revalidatePath("/operations");
  revalidatePath("/appointments");
}

async function loadReply(replyId: string) {
  const { rows } = await getPool().query(
    `SELECT r.id,r.client_id,r.prospect_id,r.from_email,r.match_status,r.classification_status,r.classification,
            p.company_name,p.contact_name,p.contact_email,p.suppression_status,p.outreach_status
     FROM connect_replies r
     LEFT JOIN connect_prospects p ON p.id=r.prospect_id
     WHERE r.id=$1 LIMIT 1`,
    [replyId]
  );
  return rows[0] ?? null;
}

function back(clientId: string | null | undefined, result: string) {
  const query = new URLSearchParams();
  if (clientId) query.set("client", clientId);
  query.set("result", result);
  redirect(`/replies?${query.toString()}`);
}

export async function classifyReplyManually(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const classification = text(form, "classification", 40).toUpperCase() as ConnectReplyClassification;
  if (!replyId || !CLASSIFICATIONS.includes(classification)) back(null, "classification_invalid");

  const reply = await loadReply(replyId);
  if (!reply?.client_id || !reply?.prospect_id || reply.match_status !== "MATCHED") back(reply?.client_id, "classification_blocked");

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE connect_replies
       SET classification_status=$2,classification=$3,classification_confidence=100,
           classification_reasons=$4::jsonb,classified_at=now(),updated_at=now()
       WHERE id=$1 AND match_status='MATCHED'`,
      [
        replyId,
        classification === "UNKNOWN" ? "NEEDS_REVIEW" : "CLASSIFIED",
        classification,
        JSON.stringify(["Staff classification from Reply Center."])
      ]
    );

    if (classification === "UNSUBSCRIBE") {
      await client.query(
        `INSERT INTO connect_suppressions (client_id,email,reason,source)
         VALUES (NULL,$1,'UNSUBSCRIBED','STAFF_REPLY_REVIEW')
         ON CONFLICT DO NOTHING`,
        [reply.from_email]
      );
      await client.query(
        `UPDATE connect_prospects
         SET suppression_status='UNSUBSCRIBED',qualification_status='SUPPRESSED',outreach_status='STOPPED',updated_at=now()
         WHERE id=$1`,
        [reply.prospect_id]
      );
    } else {
      await client.query(
        `UPDATE connect_prospects
         SET outreach_status=CASE WHEN outreach_status='STOPPED' THEN outreach_status ELSE 'REPLIED' END,updated_at=now()
         WHERE id=$1`,
        [reply.prospect_id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  revalidateConnect();
  back(reply.client_id, "classified");
}

export async function createHandoffFromReply(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const reply = await loadReply(replyId);
  if (!reply?.client_id || reply.classification !== "INTERESTED") back(reply?.client_id, "handoff_blocked");

  const result = await createConnectHandoffs(reply.client_id, 1, replyId);
  revalidateConnect();
  back(reply.client_id, result.handoffsCreated ? "handoff_created" : "handoff_exists");
}

export async function fulfillWalkthroughRequest(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const reply = await loadReply(replyId);
  if (!reply?.client_id || !reply?.prospect_id || reply.classification !== "VIDEO_REQUESTED") back(reply?.client_id, "walkthrough_blocked");

  const result = await sendRequestedConnectWalkthrough({
    replyId,
    clientId: reply.client_id,
    prospectId: reply.prospect_id,
    recipientEmail: reply.from_email,
    contactName: reply.contact_name,
    companyName: reply.company_name,
    manual: true
  });

  revalidateConnect();
  back(reply.client_id, result.sent ? "walkthrough_sent" : result.alreadySent ? "walkthrough_exists" : "walkthrough_blocked");
}

export async function scheduleReplyFollowUp(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const followUpDate = text(form, "followUpDate", 10);
  const notes = text(form, "notes", 500);
  const reply = await loadReply(replyId);
  if (!reply?.client_id || !reply?.prospect_id || !["NOT_NOW", "OUT_OF_OFFICE"].includes(String(reply.classification))) {
    back(reply?.client_id, "followup_blocked");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) back(reply.client_id, "followup_invalid");

  const dateCheck = await getPool().query(
    `SELECT ($1::date + time '09:00') AT TIME ZONE 'America/Chicago' AS due_at`,
    [followUpDate]
  );
  const dueAt = dateCheck.rows[0]?.due_at ? new Date(dateCheck.rows[0].due_at) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime()) || dueAt.getTime() < Date.now() + 60 * 60 * 1000 || dueAt.getTime() > Date.now() + 366 * 86_400_000) {
    back(reply.client_id, "followup_invalid");
  }

  await getPool().query(
    `INSERT INTO connect_follow_up_tasks (client_id,prospect_id,reply_id,due_at,reason,notes,status)
     VALUES ($1,$2,$3,$4,$5,$6,'SCHEDULED')
     ON CONFLICT (reply_id) WHERE reply_id IS NOT NULL AND status='SCHEDULED'
     DO UPDATE SET due_at=EXCLUDED.due_at,reason=EXCLUDED.reason,notes=EXCLUDED.notes,updated_at=now()`,
    [reply.client_id, reply.prospect_id, replyId, dueAt, reply.classification, notes || null]
  );

  revalidateConnect();
  back(reply.client_id, "followup_scheduled");
}

export async function completeReplyFollowUp(form: FormData) {
  await requirePageRole(["STAFF"]);
  const taskId = text(form, "taskId", 60);
  const clientId = text(form, "clientId", 60);
  await getPool().query(
    `UPDATE connect_follow_up_tasks
     SET status='COMPLETED',completed_at=now(),updated_at=now()
     WHERE id=$1 AND client_id=$2 AND status='SCHEDULED'`,
    [taskId, clientId]
  );
  revalidateConnect();
  back(clientId, "followup_completed");
}

export async function markWrongContactForReenrichment(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const reply = await loadReply(replyId);
  if (!reply?.client_id || !reply?.prospect_id || reply.classification !== "WRONG_CONTACT") back(reply?.client_id, "reenrich_blocked");

  await getPool().query(
    `UPDATE connect_prospects
     SET contact_name=NULL,contact_title=NULL,contact_email=NULL,
         enrichment_status='PARTIAL',outreach_status='NOT_READY',updated_at=now()
     WHERE id=$1 AND client_id=$2 AND suppression_status='CLEAR'`,
    [reply.prospect_id, reply.client_id]
  );

  revalidateConnect();
  back(reply.client_id, "reenrich_ready");
}

export async function stopProspectAfterObjection(form: FormData) {
  await requirePageRole(["STAFF"]);
  const replyId = text(form, "replyId", 60);
  const reply = await loadReply(replyId);
  if (!reply?.client_id || !reply?.prospect_id || reply.classification !== "OBJECTION") back(reply?.client_id, "stop_blocked");

  await getPool().query(
    `UPDATE connect_prospects SET outreach_status='STOPPED',updated_at=now()
     WHERE id=$1 AND client_id=$2`,
    [reply.prospect_id, reply.client_id]
  );

  revalidateConnect();
  back(reply.client_id, "prospect_stopped");
}
