"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { findProspectEmailWithHunter, getHunterAccountSummary, HunterApiError } from "@/lib/connect-hunter";

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
      let state = "provider_error";
      if (error.status === 401) {
        state = "auth_error";
      } else if (error.status === 403) {
        state = "rate_limited";
      } else if (error.status === 429) {
        let remaining: number | null = null;
        try {
          const account = await getHunterAccountSummary();
          const reported = account.credits?.remaining ?? account.searches?.remaining ?? null;
          remaining = typeof reported === "number" ? reported : null;
        } catch {
          remaining = null;
        }
        state = remaining !== null && remaining > 0 ? "finder_restricted" : "usage_limit";
      }

      const params = new URLSearchParams({ hunter: state, prospect: prospectId });
      if (error.errorId) params.set("code", error.errorId.slice(0, 80));
      redirect(`/prospects/hunter?${params.toString()}`);
    }
    throw error;
  }
}
