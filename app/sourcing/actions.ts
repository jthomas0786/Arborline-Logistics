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

  let destination: string;
  try {
    const result = await runConnectSourcing(clientId);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    destination = result.status === "NEEDS_PROVIDER"
      ? "/sourcing?provider=required"
      : `/sourcing?run=${encodeURIComponent(result.status.toLowerCase())}&inserted=${result.inserted}&qualified=${result.qualified}`;
  } catch (error) {
    console.error("Connect sourcing run failed", error);
    revalidatePath("/sourcing");
    destination = "/sourcing?run=failed";
  }

  // Next.js redirect() throws a NEXT_REDIRECT control-flow exception, so it must
  // stay outside the try/catch or a successful run is incorrectly reported as failed.
  redirect(destination);
}

export async function runContactEnrichment(form: FormData) {
  await requirePageRole(["STAFF"]);
  const clientId = String(form.get("clientId") ?? "").trim();
  if (!clientId) redirect("/sourcing?enrich=client_required");

  let destination: string;
  try {
    const result = await enrichQualifiedProspects(clientId, 20);
    revalidatePath("/sourcing");
    revalidatePath("/prospects");
    destination = `/sourcing?enrich=${encodeURIComponent(result.status.toLowerCase())}&attempted=${result.attempted}&enriched=${result.enriched}&suppressed=${result.suppressed}`;
  } catch (error) {
    console.error("Connect contact enrichment failed", error);
    revalidatePath("/sourcing");
    destination = "/sourcing?enrich=failed";
  }

  redirect(destination);
}
