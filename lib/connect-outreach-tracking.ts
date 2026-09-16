import { createHmac, timingSafeEqual } from "crypto";
import { getConnectUnsubscribeSigningSecret } from "@/lib/connect-unsubscribe";

const SAMPLES_CONTEXT = "arborline-connect-samples-view-v1";

function samplesSigningSecret() {
  const base = getConnectUnsubscribeSigningSecret();
  if (!base) return "";
  return createHmac("sha256", base).update(SAMPLES_CONTEXT).digest("hex");
}

export function createConnectSamplesViewToken(messageId: string) {
  const secret = samplesSigningSecret();
  if (!secret) return "";
  const payload = Buffer.from(messageId.trim(), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyConnectSamplesViewToken(token: string) {
  const secret = samplesSigningSecret();
  if (!secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const messageId = Buffer.from(payload, "base64url").toString("utf8").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)
      ? messageId
      : null;
  } catch {
    return null;
  }
}

export function connectSamplesViewUrl(messageId: string) {
  const token = createConnectSamplesViewToken(messageId);
  if (!token) return "";
  const base = (process.env.APP_BASE_URL || "https://www.arborlineconnect.com").replace(/\/$/, "");
  return `${base}/sample?alc=${encodeURIComponent(token)}`;
}
