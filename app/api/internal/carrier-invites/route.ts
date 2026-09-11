import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_INTERNAL_TOKEN;
  if (!expected) return NextResponse.json({ error: "AUTOMATION_INTERNAL_TOKEN is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
