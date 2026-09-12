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

function targetValues(target: PushTarget) {
  return [
    target.audience,
    target.userId ?? null,
    target.shipperId ?? null,
    target.carrierId ?? null,
    target.loadId ?? null,
    target.bookingId ?? null
  ] as const;
}

export async function upsertPushSubscription(target: PushTarget, subscription: BrowserPushSubscription, userAgent: string | null) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(
      `INSERT INTO web_push_subscriptions (endpoint,p256dh,auth_secret,user_agent,revoked_at,updated_at)
       VALUES ($1,$2,$3,$4,NULL,now())
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh=EXCLUDED.p256dh,
         auth_secret=EXCLUDED.auth_secret,
         user_agent=EXCLUDED.user_agent,
         revoked_at=NULL,
         failure_count=0,
         updated_at=now()
       RETURNING id`,
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent?.slice(0, 500) ?? null]
    );
    const subscriptionId = device.rows[0].id as string;
    const [audience,userId,shipperId,carrierId,loadId,bookingId] = targetValues(target);
    await client.query(
      `INSERT INTO web_push_subscription_targets
         (subscription_id,audience,user_id,shipper_id,carrier_id,load_id,booking_id)
       SELECT $1,$2,$3,$4,$5,$6,$7
       WHERE NOT EXISTS (
         SELECT 1 FROM web_push_subscription_targets
         WHERE subscription_id=$1 AND audience=$2
           AND user_id IS NOT DISTINCT FROM $3::uuid
           AND shipper_id IS NOT DISTINCT FROM $4::uuid
           AND carrier_id IS NOT DISTINCT FROM $5::uuid
           AND load_id IS NOT DISTINCT FROM $6::uuid
           AND booking_id IS NOT DISTINCT FROM $7::uuid
       )`,
      [subscriptionId,audience,userId,shipperId,carrierId,loadId,bookingId]
    );

    const recipientUser = userId ? `user:${userId}` : null;
    const recipientShipper = shipperId ? `shipper:${shipperId}` : null;
    const recipientDriver = bookingId ? `driver:${bookingId}` : null;
    const recipientCarrier = carrierId ? `carrier:${carrierId}` : null;
    await client.query(
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
      [recipientUser,recipientShipper,recipientDriver,recipientCarrier,audience === "STAFF"]
    );
    await client.query("COMMIT");
    return subscriptionId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePushSubscription(endpoint: string) {
  if (!endpoint.startsWith("https://") || endpoint.length > 4096) return;
  await getPool().query(`UPDATE web_push_subscriptions SET revoked_at=now(),updated_at=now() WHERE endpoint=$1`, [endpoint]);
}

export async function removePushTarget(endpoint: string, target: PushTarget) {
  if (!endpoint.startsWith("https://") || endpoint.length > 4096) return;
  const [audience,userId,shipperId,carrierId,loadId,bookingId] = targetValues(target);
  await getPool().query(
    `DELETE FROM web_push_subscription_targets t
     USING web_push_subscriptions s
     WHERE t.subscription_id=s.id AND s.endpoint=$1 AND t.audience=$2
       AND t.user_id IS NOT DISTINCT FROM $3::uuid
       AND t.shipper_id IS NOT DISTINCT FROM $4::uuid
       AND t.carrier_id IS NOT DISTINCT FROM $5::uuid
       AND t.load_id IS NOT DISTINCT FROM $6::uuid
       AND t.booking_id IS NOT DISTINCT FROM $7::uuid`,
    [endpoint,audience,userId,shipperId,carrierId,loadId,bookingId]
  );
}
