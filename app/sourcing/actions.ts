"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { runConnectSourcing } from "@/lib/connect-source-runner";
import { enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";

export async function runSourcing(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = String(form.get("clientId") ?? "").trim();
  if (!clientId) redirect("/sourcing?error=client_required");
  try {
    const result = await runConnectSourcing(clientId);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    if (result.status === "NEEDS_PROVIDER") redirect("/sourcing?provider=required");
    redirect(`/sourcing?run=${encodeURIComponent(result.status.toLowerCase())}&inserted=${result.inserted}&qualified=${result.qualified}`);
  } catch (error) {
    console.error("Connect sourcing run failed", error);
    revalidatePath("/sourcing");
    redirect("/sourcing?run=failed");
  }
}

export async function runContactEnrichment(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = String(form.get("clientId") ?? "").trim();
  if (!clientId) redirect("/sourcing?enrich=client_required");
  try {
    const result = await enrichQualifiedProspects(clientId, 20);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    redirect(`/sourcing?enrich=${encodeURIComponent(result.status.toLowerCase())}&attempted=${result.attempted}&enriched=${result.enriched}&suppressed=${result.suppressed}`);
  } catch (error) {
    console.error("Connect contact enrichment failed", error);
    revalidatePath("/sourcing");
    redirect("/sourcing?enrich=failed");
  }
}
