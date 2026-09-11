import { NextResponse } from "next/server";
import { processCarrierVerificationQueue, queueDueCarrierReverifications } from "@/lib/carrier-verification";
import { expireAndRecoverOffers } from "@/lib/maintenance";
import { dispatchOutbox } from "@/lib/outbox";

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_INTERNAL_TOKEN;
  if (!expected) return NextResponse.json({ error: "AUTOMATION_INTERNAL_TOKEN is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const reverification = await queueDueCarrierReverifications();
    const carrierVerification = await processCarrierVerificationQueue(Number(body.verificationLimit ?? 10));
    const maintenance = await expireAndRecoverOffers();
    const outbox = await dispatchOutbox(Number(body.outboxLimit ?? 25));
    return NextResponse.json({ reverification, carrierVerification, maintenance, outbox, ranAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation tick failed" }, { status: 500 });
  }
}
