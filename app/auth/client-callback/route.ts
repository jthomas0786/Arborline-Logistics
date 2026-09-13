import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;
  if (!code) return NextResponse.redirect(`${origin}/client-access?error=send_failed`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/client-access?error=send_failed`);

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const email = user?.email?.trim().toLowerCase();
  if (!user?.id || !email) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/client-access?error=send_failed`);
  }

  const pool = getPool();
  const inviteResult = await pool.query(
    `SELECT i.id,i.client_id,c.primary_contact_name
     FROM connect_client_invites i
     JOIN connect_clients c ON c.id=i.client_id
     WHERE lower(i.email)=lower($1) AND i.status='PENDING' AND i.expires_at>now()
     ORDER BY i.created_at DESC LIMIT 1`,
    [email]
  );
  const invite = inviteResult.rows[0];
  if (!invite) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/client-access?error=not_invited`);
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO app_users (user_id,role,connect_client_id,display_name,is_active)
       VALUES ($1,'CONNECT_CLIENT',$2,$3,true)
       ON CONFLICT (user_id) DO UPDATE SET
         role='CONNECT_CLIENT',connect_client_id=EXCLUDED.connect_client_id,
         display_name=COALESCE(EXCLUDED.display_name,app_users.display_name),is_active=true,updated_at=now()`,
      [user.id, invite.client_id, invite.primary_contact_name || email]
    );
    await db.query(
      `UPDATE connect_client_invites
       SET status='CLAIMED',claimed_by=$2,claimed_at=now(),updated_at=now()
       WHERE id=$1`,
      [invite.id, user.id]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    console.error("Client portal provisioning failed", error);
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/client-access?error=send_failed`);
  } finally {
    db.release();
  }

  return NextResponse.redirect(`${origin}/portal`);
}
