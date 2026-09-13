"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

export async function requestClientAccess(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!validEmail(email)) redirect("/client-access?error=invalid");

  const { rows } = await getPool().query(
    `SELECT id FROM connect_client_invites
     WHERE lower(email)=lower($1) AND status='PENDING' AND expires_at>now()
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  if (!rows[0]) redirect("/client-access?sent=1");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${appBaseUrl()}/auth/client-callback`
    }
  });

  if (error) {
    console.error("Client portal magic link failed", error);
    redirect("/client-access?error=send_failed");
  }

  redirect("/client-access?sent=1");
}
