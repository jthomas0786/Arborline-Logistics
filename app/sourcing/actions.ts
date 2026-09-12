"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { runConnectSourcing } from "@/lib/connect-source-runner";

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
  } catch {
    revalidatePath("/sourcing");
    redirect("/sourcing?run=failed");
  }
}
