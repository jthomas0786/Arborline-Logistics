import { redirect } from "next/navigation";
import { getPool } from "./db";
import { createClient } from "./supabase/server";

export type AppRole = "STAFF" | "SHIPPER" | "CARRIER" | "CONNECT_CLIENT";

export type AppIdentity = {
  userId: string;
  email: string | null;
  role: AppRole;
  organizationId: string | null;
  shipperId: string | null;
  carrierId: string | null;
  connectClientId: string | null;
  displayName: string | null;
};

export async function getCurrentIdentity(): Promise<AppIdentity | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const userId = typeof claims?.sub === "string" ? claims.sub : null;
    if (error || !claims || !userId) return null;

    const { rows } = await getPool().query(
      `SELECT user_id,role,organization_id,shipper_id,carrier_id,connect_client_id,display_name
       FROM app_users
       WHERE user_id=$1 AND is_active=true`,
      [userId]
    );
    const row = rows[0];
    if (!row) return null;

    return {
      userId: row.user_id,
      email: typeof claims.email === "string" ? claims.email : null,
      role: row.role as AppRole,
      organizationId: row.organization_id ?? null,
      shipperId: row.shipper_id ?? null,
      carrierId: row.carrier_id ?? null,
      connectClientId: row.connect_client_id ?? null,
      displayName: row.display_name ?? null
    };
  } catch {
    return null;
  }
}

export async function requirePageRole(allowed: AppRole[]) {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login?error=access_required");
  if (!allowed.includes(identity.role)) redirect("/unauthorized");
  return identity;
}

export async function requireApiRole(allowed: AppRole[]) {
  const identity = await getCurrentIdentity();
  if (!identity) return { identity: null, status: 401 as const, error: "Authentication required" };
  if (!allowed.includes(identity.role)) return { identity: null, status: 403 as const, error: "Forbidden" };
  return { identity, status: 200 as const, error: null };
}
