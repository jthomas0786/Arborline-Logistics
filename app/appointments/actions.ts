"use server";

import { revalidatePath } from "next/cache";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

function text(formData: FormData, name: string, max = 1000) {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function handoffId(formData: FormData) {
  const id = text(formData, "handoffId", 60);
  if (!id) throw new Error("Handoff id is required.");
  return id;
}

function refreshHandoffViews(prospectId?: string | null, clientId?: string | null) {
  revalidatePath("/appointments");
  revalidatePath("/operations");
  revalidatePath("/clients");
  revalidatePath("/prospects");
  revalidatePath("/growth");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

export async function scheduleConnectHandoff(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const scheduledFor = text(formData, "scheduledFor", 40);
  const meetingUrl = text(formData, "meetingUrl", 500) || null;
  const notes = text(formData, "notes", 1500) || null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledFor)) throw new Error("A valid appointment date and time is required.");

  const pool = getPool();
  const db = await pool.connect();
  let prospectId: string | null = null;
  let clientId: string | null = null;
  try {
    await db.query("BEGIN");
    const updated = await db.query(
      `UPDATE connect_handoffs h
       SET status='SCHEDULED',
           scheduled_for=($2::timestamp AT TIME ZONE c.timezone),
           meeting_url=$3,
           notes=COALESCE($4,h.notes),
           updated_at=now()
       FROM connect_clients c
       WHERE h.id=$1
         AND c.id=h.client_id
         AND h.status IN ('READY_FOR_REVIEW','SCHEDULING')
       RETURNING h.prospect_id,h.client_id`,
      [id, scheduledFor, meetingUrl, notes]
    );
    prospectId = updated.rows[0]?.prospect_id || null;
    clientId = updated.rows[0]?.client_id || null;
    if (!prospectId) throw new Error("Handoff was not found or is no longer available to schedule.");
    await db.query(
      `UPDATE connect_prospects SET outreach_status='BOOKED',updated_at=now() WHERE id=$1 AND outreach_status<>'STOPPED'`,
      [prospectId]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  refreshHandoffViews(prospectId, clientId);
}

export async function markConnectHandoffHeld(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const result = await getPool().query(
    `UPDATE connect_handoffs
     SET status='HELD',held_at=COALESCE(held_at,now()),closed_at=NULL,updated_at=now()
     WHERE id=$1 AND status='SCHEDULED'
     RETURNING prospect_id,client_id`,
    [id]
  );
  refreshHandoffViews(result.rows[0]?.prospect_id || null, result.rows[0]?.client_id || null);
}

export async function markConnectHandoffNoShow(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const notes = text(formData, "outcomeNotes", 1500) || null;
  const result = await getPool().query(
    `UPDATE connect_handoffs
     SET status='NO_SHOW',closed_at=NULL,outcome_notes=COALESCE($2,outcome_notes),updated_at=now()
     WHERE id=$1 AND status='SCHEDULED'
     RETURNING prospect_id,client_id`,
    [id, notes]
  );
  refreshHandoffViews(result.rows[0]?.prospect_id || null, result.rows[0]?.client_id || null);
}

export async function declineConnectHandoff(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const notes = text(formData, "outcomeNotes", 1500) || null;
  const pool = getPool();
  const db = await pool.connect();
  let prospectId: string | null = null;
  let clientId: string | null = null;
  try {
    await db.query("BEGIN");
    const updated = await db.query(
      `UPDATE connect_handoffs SET status='DECLINED',closed_at=now(),outcome_notes=COALESCE($2,outcome_notes),updated_at=now()
       WHERE id=$1 AND status IN ('READY_FOR_REVIEW','SCHEDULING') RETURNING prospect_id,client_id`,
      [id, notes]
    );
    prospectId = updated.rows[0]?.prospect_id || null;
    clientId = updated.rows[0]?.client_id || null;
    if (prospectId) await db.query(
      `UPDATE connect_prospects SET outreach_status='REPLIED',updated_at=now() WHERE id=$1 AND outreach_status='BOOKED'`,
      [prospectId]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  refreshHandoffViews(prospectId, clientId);
}
