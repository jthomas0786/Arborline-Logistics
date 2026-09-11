import { NextResponse } from "next/server";
import { respondToOffer } from "@/lib/workflow";
import type { OfferResponse } from "@/lib/types";

const responses = new Set<OfferResponse>(["ACCEPT","DECLINE","COUNTER"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (!responses.has(body.response)) return NextResponse.json({ error: "response must be ACCEPT, DECLINE, or COUNTER" }, { status: 400 });
    const result = await respondToOffer(id, body.response, body.counterRate === undefined ? undefined : Number(body.counterRate));
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to respond to offer" }, { status: 400 });
  }
}
