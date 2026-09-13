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

export async function scheduleConnectHandoff(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const scheduledFor = text(formData, "scheduledFor", 40);
  const meetingUrl = text(formData, "meetingUrl", 500) || null;
  const notes = text(formData, "notes", 1500) || null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledFor)) throw new Error("A valid appointment date and time is required.");

  const pool = getPool();
  const db = await pool.connect();
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
       WHERE h.id=$1 AND c.id=h.client_id
       RETURNING h.prospect_id`,
      [id, scheduledFor, meetingUrl, notes]
    );
    const prospectId = updated.rows[0]?.prospect_id;
    if (!prospectId) throw new Error("Handoff was not found.");
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
  revalidatePath("/appointments");
  revalidatePath("/growth");
}

export async function markConnectHandoffHeld(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  await getPool().query(
    `UPDATE connect_handoffs SET status='HELD',held_at=now(),closed_at=now(),updated_at=now() WHERE id=$1 AND status='SCHEDULED'`,
    [id]
  );
  revalidatePath("/appointments");
  revalidatePath("/growth");
}

export async function markConnectHandoffNoShow(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const notes = text(formData, "outcomeNotes", 1500) || null;
  await getPool().query(
    `UPDATE connect_handoffs SET status='NO_SHOW',closed_at=now(),outcome_notes=COALESCE($2,outcome_notes),updated_at=now() WHERE id=$1 AND status='SCHEDULED'`,
    [id, notes]
  );
  revalidatePath("/appointments");
  revalidatePath("/growth");
}

export async function declineConnectHandoff(formData: FormData) {
  await requirePageRole(["STAFF"]);
  const id = handoffId(formData);
  const notes = text(formData, "outcomeNotes", 1500) || null;
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const updated = await db.query(
      `UPDATE connect_handoffs SET status='DECLINED',closed_at=now(),outcome_notes=COALESCE($2,outcome_notes),updated_at=now()
       WHERE id=$1 AND status IN ('READY_FOR_REVIEW','SCHEDULING') RETURNING prospect_id`,
      [id, notes]
    );
    const prospectId = updated.rows[0]?.prospect_id;
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
  revalidatePath("/appointments");
  revalidatePath("/growth");
}
