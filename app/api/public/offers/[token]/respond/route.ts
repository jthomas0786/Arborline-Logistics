import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { respondToOffer } from "@/lib/workflow";
import type { OfferResponse } from "@/lib/types";

const responses = new Set<OfferResponse>(["ACCEPT","DECLINE","COUNTER"]);

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = await request.json();
    if (!responses.has(body.response)) return NextResponse.json({ error: "response must be ACCEPT, DECLINE, or COUNTER" }, { status: 400 });
    const { rows } = await getPool().query(`SELECT id FROM offers WHERE public_token=$1`, [token]);
    if (!rows[0]) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    const result = await respondToOffer(rows[0].id, body.response, body.counterRate === undefined ? undefined : Number(body.counterRate));
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to respond to offer" }, { status: 400 });
  }
}
