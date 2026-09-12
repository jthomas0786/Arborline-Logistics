import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { parseBrowserPushSubscription, upsertPushSubscription, type PushTarget } from "@/lib/push-subscriptions";
import { webPushConfig } from "@/lib/web-push";

async function resolveTarget(kind: string, token: string): Promise<PushTarget | null> {
  const pool = getPool();
  if (kind === "CARRIER_OFFER") {
    const { rows } = await pool.query(
      `SELECT carrier_id,load_id FROM offers
       WHERE public_token::text=$1
         AND status IN ('PENDING','OPENED','COUNTERED','ACCEPTED')
         AND (expires_at IS NULL OR expires_at>now() OR status='ACCEPTED')`,
      [token]
    );
    return rows[0] ? { audience: "CARRIER", carrierId: rows[0].carrier_id, loadId: rows[0].load_id } : null;
  }
  if (kind === "CARRIER_DISPATCH") {
    const { rows } = await pool.query(
      `SELECT carrier_id,load_id FROM offers WHERE public_token::text=$1 AND status='ACCEPTED'`,
      [token]
    );
    return rows[0] ? { audience: "CARRIER", carrierId: rows[0].carrier_id, loadId: rows[0].load_id } : null;
  }
  if (kind === "DRIVER_LOAD") {
    const { rows } = await pool.query(
      `SELECT b.id booking_id,b.carrier_id,b.load_id
       FROM bookings b JOIN loads l ON l.id=b.load_id
       WHERE b.tracking_token::text=$1 AND l.status NOT IN ('CANCELLED','CLOSED')`,
      [token]
    );
    return rows[0] ? { audience: "DRIVER", carrierId: rows[0].carrier_id, loadId: rows[0].load_id, bookingId: rows[0].booking_id } : null;
  }
  return null;
}

export async function POST(request: Request) {
  const config = webPushConfig();
  if (!config.ready) return NextResponse.json({ error: "Web Push is not configured." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";
  const token = typeof body.token === "string" ? body.token : "";
  const subscription = parseBrowserPushSubscription(body.subscription);
  if (!subscription || !token) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  const target = await resolveTarget(kind, token);
  if (!target) return NextResponse.json({ error: "Notification link is invalid or expired." }, { status: 404 });
  const id = await upsertPushSubscription(target, subscription, request.headers.get("user-agent"));
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === "string" ? body.kind : "";
  const token = typeof body.token === "string" ? body.token : "";
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const target = await resolveTarget(kind, token);
  if (!target || !endpoint) return NextResponse.json({ error: "Invalid notification subscription." }, { status: 400 });
  const pool = getPool();
  await pool.query(
    `UPDATE web_push_subscriptions
     SET revoked_at=now(),updated_at=now()
     WHERE endpoint=$1
       AND (($2::uuid IS NOT NULL AND carrier_id=$2) OR ($3::uuid IS NOT NULL AND booking_id=$3))`,
    [endpoint, target.carrierId ?? null, target.bookingId ?? null]
  );
  return NextResponse.json({ ok: true });
}
