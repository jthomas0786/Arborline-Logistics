import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET() {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  const { rows } = await getPool().query(
    `SELECT id,public_token,contact_email,status,expires_at,submitted_at,created_at
     FROM carrier_invites ORDER BY created_at DESC LIMIT 50`
  );
  return NextResponse.json({ invites: rows });
}

export async function POST(request: Request) {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    const body = await request.json().catch(() => ({}));
    const expiresHours = Math.max(1, Math.min(168, Number(body.expiresHours ?? 72)));
    const contactEmail = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
    const { rows } = await getPool().query(
      `INSERT INTO carrier_invites (contact_email,expires_at)
       VALUES ($1,now()+($2 * interval '1 hour'))
       RETURNING id,public_token,contact_email,status,expires_at`,
      [contactEmail, expiresHours]
    );
    const invite = rows[0];
    const invitePath = `/carrier/onboard/${invite.public_token}`;
    const base = (process.env.APP_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    if (contactEmail) {
      await getPool().query(
        `INSERT INTO outbox_messages (channel,recipient,template,payload)
         VALUES ('EMAIL',$1,'CARRIER_INVITE',$2::jsonb)`,
        [contactEmail, JSON.stringify({ invitePath, expiresAt: invite.expires_at })]
      );
    }
    return NextResponse.json({ invite: { ...invite, inviteUrl: `${base}${invitePath}` } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create carrier invite" }, { status: 400 });
  }
}
