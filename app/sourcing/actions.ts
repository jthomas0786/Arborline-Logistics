"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { runConnectSourcing } from "@/lib/connect-source-runner";
import { enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";

function parseProfile(form: FormData) {
  const raw = String(form.get("profile") ?? "").trim();
  if (raw.startsWith("client:")) {
    const clientId = raw.slice("client:".length).trim();
    return clientId ? { clientId, segmentId: null as string | null } : null;
  }
  if (raw.startsWith("segment:")) {
    const [, clientId, segmentId] = raw.split(":");
    return clientId && segmentId ? { clientId, segmentId } : null;
  }
  return null;
}

export async function approveProspectSegment(form: FormData) {
  await requirePageRole(["STAFF"]);
  const segmentId = String(form.get("segmentId") ?? "").trim();
  if (!segmentId) redirect("/sourcing?segment=invalid");

  const result = await getPool().query(
    `UPDATE connect_prospect_segments
     SET status='APPROVED',approved_at=COALESCE(approved_at,now()),updated_at=now()
     WHERE id=$1 AND status='DRAFT'
     RETURNING id`,
    [segmentId]
  );
  revalidatePath("/sourcing");
  redirect(`/sourcing?segment=${result.rows[0] ? "approved" : "unchanged"}`);
}

export async function runSourcing(form: FormData) {
  await requirePageRole(["STAFF"]);
  const profile = parseProfile(form);
  if (!profile) redirect("/sourcing?error=profile_required");

  let destination: string;
  try {
    const result = await runConnectSourcing(profile.clientId, profile.segmentId);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    revalidatePath("/growth");
    destination = result.status === "NEEDS_PROVIDER"
      ? "/sourcing?provider=required"
      : `/sourcing?run=${encodeURIComponent(result.status.toLowerCase())}&inserted=${result.inserted}&qualified=${result.qualified}`;
  } catch (error) {
    console.error("Connect sourcing run failed", error);
    revalidatePath("/sourcing");
    revalidatePath("/growth");
    destination = "/sourcing?run=failed";
  }

  redirect(destination);
}

export async function runContactEnrichment(form: FormData) {
  await requirePageRole(["STAFF"]);
  const profile = parseProfile(form);
  if (!profile) redirect("/sourcing?enrich=profile_required");

  let destination: string;
  try {
    const result = await enrichQualifiedProspects(profile.clientId, 20, profile.segmentId);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    revalidatePath("/growth");
    destination = `/sourcing?enrich=${encodeURIComponent(result.status.toLowerCase())}&attempted=${result.attempted}&enriched=${result.enriched}&suppressed=${result.suppressed}`;
  } catch (error) {
    console.error("Connect contact enrichment failed", error);
    revalidatePath("/sourcing");
    revalidatePath("/growth");
    destination = "/sourcing?enrich=failed";
  }

  redirect(destination);
}
