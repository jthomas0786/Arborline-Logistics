import crypto from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";

type StripeCheckoutClient = {
  id: string;
  companyName: string;
  email: string | null;
  stripeCustomerId: string | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function appBaseUrl() {
  return (process.env.APP_BASE_URL?.trim() || "https://www.arborlineconnect.com").replace(/\/$/, "");
}

async function stripePost(path: string, params: URLSearchParams, idempotencyKey?: string) {
  const secretKey = requiredEnv("STRIPE_SECRET_KEY");
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: params,
    signal: AbortSignal.timeout(15_000)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error?.message === "string" ? body.error.message : `Stripe request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as Record<string, unknown>;
}

export async function createFoundingClientCheckout(client: StripeCheckoutClient) {
  const monthlyPrice = requiredEnv("STRIPE_FOUNDING_MONTHLY_PRICE_ID");
  const params = new URLSearchParams();

  params.set("mode", "subscription");
  params.set("success_url", `${appBaseUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${appBaseUrl()}/checkout/canceled`);
  params.set("client_reference_id", client.id);
  params.set("billing_address_collection", "required");
  params.append("payment_method_types[]", "card");
  params.append("payment_method_types[]", "us_bank_account");
  params.set("line_items[0][price]", monthlyPrice);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[client_id]", client.id);
  params.set("metadata[arborline_offer]", "founding_client_750");
  params.set("metadata[setup_fee]", "waived");
  params.set("subscription_data[metadata][client_id]", client.id);
  params.set("subscription_data[metadata][arborline_offer]", "founding_client_750");
  params.set("subscription_data[metadata][setup_fee]", "waived");
  params.set("custom_text[submit][message]", `ArborLine Connect Founding Client — $750/month, $0 setup, month-to-month. Onboarding for ${client.companyName}.`);

  if (client.stripeCustomerId) params.set("customer", client.stripeCustomerId);
  else if (client.email) params.set("customer_email", client.email);

  const session = await stripePost(
    "/checkout/sessions",
    params,
    `connect-checkout-${client.id}-${monthlyPrice}`
  );

  if (typeof session.id !== "string" || typeof session.url !== "string") {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { id: session.id, url: session.url };
}

export async function createConnectBillingPortalSession(customerId: string) {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", `${appBaseUrl()}/portal/billing`);
  const session = await stripePost("/billing_portal/sessions", params);
  if (typeof session.url !== "string") throw new Error("Stripe did not return a billing portal URL.");
  return session.url;
}

export function verifyStripeWebhookSignature(payload: string, signatureHeader: string | null) {
  const secret = requiredEnv("STRIPE_WEBHOOK_SECRET");
  if (!signatureHeader) return false;

  const values = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = values.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = values.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expectedBuffer.length && crypto.timingSafeEqual(candidate, expectedBuffer);
  });
}
