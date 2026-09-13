import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_FOUNDING_MONTHLY_PRICE_ID?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!secretKey || !priceId || !webhookSecret) {
    return NextResponse.json({
      service: "arborline-connect-stripe",
      status: "misconfigured",
      secretKeyConfigured: Boolean(secretKey),
      monthlyPriceConfigured: Boolean(priceId),
      webhookSecretConfigured: Boolean(webhookSecret),
    }, { status: 503 });
  }

  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return NextResponse.json({
        service: "arborline-connect-stripe",
        status: "stripe_unreachable_or_unauthorized",
        webhookSecretConfigured: true,
      }, { status: 503 });
    }

    const price = await response.json() as {
      active?: boolean;
      livemode?: boolean;
      currency?: string;
      unit_amount?: number;
      recurring?: { interval?: string; interval_count?: number } | null;
    };

    const validFoundingPrice = Boolean(
      price.active &&
      price.currency === "usd" &&
      price.unit_amount === 75_000 &&
      price.recurring?.interval === "month" &&
      price.recurring?.interval_count === 1
    );

    return NextResponse.json({
      service: "arborline-connect-stripe",
      status: validFoundingPrice ? "ok" : "unexpected_price_configuration",
      stripeMode: price.livemode ? "live" : "test",
      priceActive: Boolean(price.active),
      monthlyAmountUsd: typeof price.unit_amount === "number" ? price.unit_amount / 100 : null,
      billingInterval: price.recurring?.interval ?? null,
      webhookSecretConfigured: true,
      timestamp: new Date().toISOString(),
    }, { status: validFoundingPrice ? 200 : 503 });
  } catch {
    return NextResponse.json({
      service: "arborline-connect-stripe",
      status: "stripe_check_failed",
      webhookSecretConfigured: true,
    }, { status: 503 });
  }
}
