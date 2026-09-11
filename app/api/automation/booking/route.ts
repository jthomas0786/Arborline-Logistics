import { NextResponse } from "next/server";
import { decideBooking } from "@/lib/automation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.shipperRate !== "number" || typeof body.carrierRate !== "number") {
      return NextResponse.json({ error: "shipperRate and carrierRate are required numbers" }, { status: 400 });
    }
    return NextResponse.json({ decision: decideBooking(body) });
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
}
