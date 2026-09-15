"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { findProspectEmailWithHunter, HunterApiError } from "@/lib/connect-hunter";

function text(form: FormData, name: string, max = 1000) {
  return String(form.get(name) ?? "").trim().slice(0, max);
}

export async function runHunterLookup(form: FormData) {
  await requirePageRole(["STAFF"]);
  const prospectId = text(form, "prospectId", 60);
  if (!prospectId) redirect("/prospects/hunter?hunter=invalid");

  try {
    const result = await findProspectEmailWithHunter(prospectId);
    revalidatePath("/prospects");
    revalidatePath("/prospects/hunter");
    revalidatePath("/campaigns");
    revalidatePath("/growth");

    const params = new URLSearchParams({ prospect: prospectId });
    if (result.status === "FOUND") {
      params.set("hunter", "found");
      params.set("score", String(result.score));
      params.set("credits", String(result.creditsCharged));
    } else if (result.status === "NOT_FOUND") {
      params.set("hunter", "not_found");
      params.set("credits", String(result.creditsCharged));
    } else if (result.status === "LOW_CONFIDENCE") {
      params.set("hunter", "low_confidence");
      params.set("score", String(result.score));
      params.set("minimum", String(result.minimumScore));
      params.set("credits", String(result.creditsCharged));
    } else if (result.status === "DOMAIN_MISMATCH") {
      params.set("hunter", "domain_mismatch");
      params.set("score", String(result.score));
      params.set("credits", String(result.creditsCharged));
    } else if (result.status === "SUPPRESSED") {
      params.set("hunter", "suppressed");
      params.set("score", String(result.score));
      params.set("credits", String(result.creditsCharged));
    } else {
      params.set("hunter", "ineligible");
    }
    redirect(`/prospects/hunter?${params.toString()}`);
  } catch (error) {
    if (error instanceof HunterApiError) {
      const state = error.status === 401 || error.status === 403 ? "auth_error" : error.status === 429 ? "rate_limited" : "provider_error";
      redirect(`/prospects/hunter?hunter=${state}&prospect=${encodeURIComponent(prospectId)}`);
    }
    throw error;
  }
}
