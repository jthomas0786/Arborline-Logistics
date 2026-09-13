"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConnectClient } from "@/lib/connect-client-portal";
import { getPool } from "@/lib/db";

const OUTCOME_ACTIONS = new Set([
  "HELD",
  "NO_SHOW",
  "FOLLOW_UP_NEEDED",
  "ESTIMATE_SENT",
  "WON",
  "LOST"
]);

function text(form: FormData, name: string, max = 2000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

function monthlyValue(form: FormData) {
  const raw = text(form, "estimatedMonthlyValue", 40).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 99_999_999.99) return Number.NaN;
  return Math.round(value * 100) / 100;
}

export async function updateClientHandoffOutcome(form: FormData) {
  const { identity, client } = await requireConnectClient();
  const handoffId = text(form, "handoffId", 60);
  const action = text(form, "outcome", 40);
  const notes = text(form, "outcomeNotes", 2000) || null;
  const returnTo = text(form, "returnTo", 300);
  const estimatedMonthlyValue = monthlyValue(form);

  if (!handoffId || !OUTCOME_ACTIONS.has(action)) {
    redirect(returnTo || "/portal/appointments?outcome=invalid");
  }
  if (Number.isNaN(estimatedMonthlyValue)) {
    redirect("/portal/appointments?outcome=value_invalid");
  }

  const status = action === "NO_SHOW" ? "NO_SHOW" : action === "WON" || action === "LOST" ? "CLOSED" : "HELD";
  const clientOutcome = ["FOLLOW_UP_NEEDED","ESTIMATE_SENT","WON","LOST"].includes(action) ? action : null;

  const result = await getPool().query(
    `UPDATE connect_handoffs
     SET status=$3,
         client_outcome=$4,
         outcome_notes=$5,
         estimated_monthly_value=$6,
         held_at=CASE WHEN $3='HELD' THEN COALESCE(held_at,now()) ELSE held_at END,
         closed_at=CASE WHEN $3='CLOSED' THEN COALESCE(closed_at,now()) ELSE NULL END,
         outcome_updated_at=now(),
         outcome_updated_by=$7,
         updated_at=now()
     WHERE id=$1 AND client_id=$2 AND status <> 'DECLINED'
     RETURNING prospect_id`,
    [handoffId, client.id, status, clientOutcome, notes, estimatedMonthlyValue, identity.userId]
  );

  const updated = result.rows[0];
  if (!updated) redirect(returnTo || "/portal/appointments?outcome=not_found");

  revalidatePath("/portal");
  revalidatePath("/portal/appointments");
  revalidatePath(`/portal/opportunities/${updated.prospect_id}`);
  redirect(returnTo || "/portal/appointments?outcome=updated");
}
