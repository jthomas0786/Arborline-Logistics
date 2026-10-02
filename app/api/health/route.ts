import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "ArborLine Connect", runtime: "web" },
    { headers: { "cache-control": "no-store" } }
  );
}
