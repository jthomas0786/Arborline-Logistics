"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!email || password.length < 8) redirect("/login?error=invalid_input");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=invalid_credentials");

  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) {
    await supabase.auth.signOut();
    redirect("/login?error=invalid_session");
  }

  const { rows } = await getPool().query(
    `SELECT role FROM app_users WHERE user_id=$1 AND is_active=true`,
    [userId]
  );
  const role = rows[0]?.role as string | undefined;
  if (!role) {
    await supabase.auth.signOut();
    redirect("/login?error=access_required");
  }

  if (next) redirect(next);
  if (role === "SHIPPER") redirect("/shipper/new");
  if (role === "CARRIER") redirect("/carrier");
  if (role === "STAFF") redirect("/operations");
  redirect("/operations");
}
