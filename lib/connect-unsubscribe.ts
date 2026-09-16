import { createHmac, timingSafeEqual } from "crypto";

const FALLBACK_DERIVATION_CONTEXT = "arborline-connect-unsubscribe-signing-v1";

export function getConnectUnsubscribeSigningSecret() {
  const explicit = process.env.CONNECT_UNSUBSCRIBE_SECRET?.trim() || "";
  if (explicit) return explicit;

  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  if (!cronSecret) return "";

  return createHmac("sha256", cronSecret)
    .update(FALLBACK_DERIVATION_CONTEXT)
    .digest("hex");
}

export function createConnectUnsubscribeToken(messageId: string, secret = getConnectUnsubscribeSigningSecret()) {
  if (!secret) return "";
  const payload = Buffer.from(messageId, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyConnectUnsubscribeToken(token: string, secret = getConnectUnsubscribeSigningSecret()) {
  if (!secret) return null;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const messageId = Buffer.from(payload, "base64url").toString("utf8").trim();
    return messageId || null;
  } catch {
    return null;
  }
}
