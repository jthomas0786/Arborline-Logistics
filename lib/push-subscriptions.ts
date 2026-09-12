import { getPool } from "./db";

export type PushAudience = "STAFF" | "SHIPPER" | "CARRIER" | "DRIVER";
export type PushTarget = {
  audience: PushAudience;
  userId?: string | null;
  shipperId?: string | null;
  carrierId?: string | null;
  loadId?: string | null;
  bookingId?: string | null;
};

export type BrowserPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function parseBrowserPushSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof subscription.endpoint === "string" ? subscription.endpoint.trim() : "";
  const p256dh = typeof subscription.keys?.p256dh === "string" ? subscription.keys.p256dh.trim() : "";
  const auth = typeof subscription.keys?.auth === "string" ? subscription.keys.auth.trim() : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 4096 || !p256dh || p256dh.length > 512 || !auth || auth.length > 512) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function upsertPushSubscription(target: PushTarget, subscription: BrowserPushSubscription, userAgent: string | null) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO web_push_subscriptions
       (endpoint,p256dh,auth_secret,audience,user_id,shipper_id,carrier_id,load_id,booking_id,user_agent,revoked_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,now())
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh=EXCLUDED.p256dh,
       auth_secret=EXCLUDED.auth_secret,
       audience=EXCLUDED.audience,
       user_id=EXCLUDED.user_id,
       shipper_id=EXCLUDED.shipper_id,
       carrier_id=EXCLUDED.carrier_id,
       load_id=EXCLUDED.load_id,
       booking_id=EXCLUDED.booking_id,
       user_agent=EXCLUDED.user_agent,
       revoked_at=NULL,
       failure_count=0,
       updated_at=now()
     RETURNING id`,
    [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      target.audience,
      target.userId ?? null,
      target.shipperId ?? null,
      target.carrierId ?? null,
      target.loadId ?? null,
      target.bookingId ?? null,
      userAgent?.slice(0, 500) ?? null
    ]
  );

  const recipientUser = target.userId ? `user:${target.userId}` : null;
  const recipientShipper = target.shipperId ? `shipper:${target.shipperId}` : null;
  const recipientDriver = target.bookingId ? `driver:${target.bookingId}` : null;
  const recipientCarrier = target.carrierId ? `carrier:${target.carrierId}` : null;
  await pool.query(
    `UPDATE outbox_messages
     SET status='PENDING',available_at=now(),last_error=NULL,provider_status=NULL
     WHERE channel='PUSH' AND status='WAITING_SUBSCRIBER'
       AND (
         ($1::text IS NOT NULL AND recipient=$1)
         OR ($2::text IS NOT NULL AND recipient=$2)
         OR ($3::text IS NOT NULL AND recipient=$3)
         OR ($4::text IS NOT NULL AND recipient=$4)
         OR ($5::boolean AND recipient='staff')
       )`,
    [recipientUser, recipientShipper, recipientDriver, recipientCarrier, target.audience === "STAFF"]
  );

  return rows[0]?.id as string;
}

export async function revokePushSubscription(endpoint: string) {
  if (!endpoint.startsWith("https://") || endpoint.length > 4096) return;
  await getPool().query(
    `UPDATE web_push_subscriptions SET revoked_at=now(),updated_at=now() WHERE endpoint=$1`,
    [endpoint]
  );
}
