import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { parseBrowserPushSubscription, revokePushSubscription, upsertPushSubscription } from "@/lib/push-subscriptions";
import { webPushConfig } from "@/lib/web-push";

export async function GET() {
  const auth = await requireApiRole(["STAFF","SHIPPER","CARRIER"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = webPushConfig();
  return NextResponse.json({ enabled: config.ready, publicKey: config.publicKey || null });
}

export async function POST(request: Request) {
  const auth = await requireApiRole(["STAFF","SHIPPER","CARRIER"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const config = webPushConfig();
  if (!config.ready) return NextResponse.json({ error: "Web Push is not configured." }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const subscription = parseBrowserPushSubscription(body.subscription);
  if (!subscription) return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });

  const identity = auth.identity;
  const id = await upsertPushSubscription({
    audience: identity.role,
    userId: identity.userId,
    shipperId: identity.shipperId,
    carrierId: identity.carrierId
  }, subscription, request.headers.get("user-agent"));
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request) {
  const auth = await requireApiRole(["STAFF","SHIPPER","CARRIER"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  await revokePushSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
