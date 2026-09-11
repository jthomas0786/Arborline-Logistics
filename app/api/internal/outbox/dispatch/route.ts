import { NextResponse } from "next/server";
import { dispatchOutbox } from "@/lib/outbox";

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_INTERNAL_TOKEN;
  if (!expected) return NextResponse.json({ error: "AUTOMATION_INTERNAL_TOKEN is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ result: await dispatchOutbox(Number(body.limit ?? 25)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to dispatch outbox" }, { status: 500 });
  }
}
