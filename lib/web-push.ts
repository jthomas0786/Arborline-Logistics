import webPush from "web-push";
import { CommunicationProviderError, deploymentBaseUrl, renderCommunication, type OutboxMessage } from "./communications";
import { getPool } from "./db";

export class NoPushSubscriptionError extends Error {
  constructor() {
    super("No active Web Push subscription is registered for this recipient.");
    this.name = "NoPushSubscriptionError";
  }
}

export async function getWebPushConfig() {
  const pool = getPool();
  const existing = await pool.query(`SELECT public_key,private_key FROM web_push_vapid_config WHERE singleton=true`);
  let row = existing.rows[0];
  if (!row) {
    const generated = webPush.generateVAPIDKeys();
    await pool.query(
      `INSERT INTO web_push_vapid_config (singleton,public_key,private_key)
       VALUES (true,$1,$2)
       ON CONFLICT (singleton) DO NOTHING`,
      [generated.publicKey, generated.privateKey]
    );
    const created = await pool.query(`SELECT public_key,private_key FROM web_push_vapid_config WHERE singleton=true`);
    row = created.rows[0];
  }
  if (!row?.public_key || !row?.private_key) throw new CommunicationProviderError("Web Push VAPID configuration is unavailable.");
  const configuredSubject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  const base = deploymentBaseUrl();
  const subject = configuredSubject || (base.startsWith("https://") ? base : "mailto:notifications@arborline-logistics.vercel.app");
  return { publicKey: String(row.public_key), privateKey: String(row.private_key), subject, ready: true as const };
}

function notificationUrl(message: OutboxMessage) {
  const payload = message.payload ?? {};
  const candidate = typeof payload.actionUrl === "string" ? payload.actionUrl
    : typeof payload.offerPath === "string" ? payload.offerPath
      : typeof payload.invitePath === "string" ? payload.invitePath
        : typeof payload.trackingPath === "string" ? payload.trackingPath
          : null;
  if (!candidate) return deploymentBaseUrl();
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `${deploymentBaseUrl()}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const parsed = Number((error as { statusCode?: unknown }).statusCode);
  return Number.isFinite(parsed) ? parsed : null;
}

async function targetSubscriptions(message: OutboxMessage) {
  const pool = getPool();
  const recipient = String(message.recipient ?? "");
  const select = `SELECT DISTINCT s.id,s.endpoint,s.p256dh,s.auth_secret
                  FROM web_push_subscriptions s
                  JOIN web_push_subscription_targets t ON t.subscription_id=s.id`;
  if (recipient === "staff") {
    return pool.query(
      `${select}
       JOIN app_users u ON u.user_id=t.user_id
       WHERE s.revoked_at IS NULL AND t.audience='STAFF' AND u.role='STAFF' AND u.is_active=true`
    );
  }
  if (recipient.startsWith("user:")) {
    return pool.query(`${select} WHERE s.revoked_at IS NULL AND t.user_id=$1::uuid`, [recipient.slice(5)]);
  }
  if (recipient.startsWith("shipper:")) {
    return pool.query(
      `${select} WHERE s.revoked_at IS NULL AND t.shipper_id=$1::uuid AND t.audience='SHIPPER'`,
      [recipient.slice(8)]
    );
  }
  if (recipient.startsWith("driver:")) {
    return pool.query(
      `${select} WHERE s.revoked_at IS NULL AND t.booking_id=$1::uuid AND t.audience='DRIVER'`,
      [recipient.slice(7)]
    );
  }
  const carrierId = recipient.startsWith("carrier:") ? recipient.slice(8) : message.carrier_id;
  if (carrierId) {
    return pool.query(
      `${select} WHERE s.revoked_at IS NULL AND t.carrier_id=$1::uuid AND t.audience='CARRIER'`,
      [carrierId]
    );
  }
  throw new NoPushSubscriptionError();
}

export async function sendWithWebPush(message: OutboxMessage) {
  const config = await getWebPushConfig();
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subscriptions = await targetSubscriptions(message);
  if (!subscriptions.rows.length) throw new NoPushSubscriptionError();

  const rendered = renderCommunication(message);
  const url = notificationUrl(message);
  const notification = JSON.stringify({
    title: rendered.subject,
    body: rendered.text.length > 260 ? `${rendered.text.slice(0, 257)}…` : rendered.text,
    url,
    tag: `${message.template}-${message.load_id ?? message.id}`,
    data: { outboxId: message.id, loadId: message.load_id, template: message.template }
  });

  let accepted = 0;
  let revoked = 0;
  let failed = 0;
  let lastFailure = "";
  const ttl = message.template === "LOAD_OFFER" ? 15 * 60 : 4 * 60 * 60;

  for (const subscription of subscriptions.rows) {
    try {
      await webPush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } },
        notification,
        { TTL: ttl, urgency: "high" }
      );
      accepted += 1;
      await getPool().query(
        `UPDATE web_push_subscriptions SET last_success_at=now(),failure_count=0,updated_at=now() WHERE id=$1`,
        [subscription.id]
      );
    } catch (error) {
      const code = statusCode(error);
      if (code === 404 || code === 410) {
        revoked += 1;
        await getPool().query(`UPDATE web_push_subscriptions SET revoked_at=now(),updated_at=now() WHERE id=$1`, [subscription.id]);
      } else {
        failed += 1;
        lastFailure = error instanceof Error ? error.message : "Web Push delivery failed";
        await getPool().query(
          `UPDATE web_push_subscriptions SET failure_count=failure_count+1,updated_at=now() WHERE id=$1`,
          [subscription.id]
        );
      }
    }
  }

  if (accepted === 0) {
    if (failed === 0) throw new NoPushSubscriptionError();
    throw new CommunicationProviderError(lastFailure || "Web Push delivery failed.", 503);
  }

  return {
    provider: "WEB_PUSH",
    providerMessageId: `outbox-${message.id}`,
    providerStatus: "accepted",
    metadata: { subscriptionCount: subscriptions.rows.length, accepted, revoked, failed }
  };
}
