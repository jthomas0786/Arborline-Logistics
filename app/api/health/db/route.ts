import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getPool().query("select 1");
    return NextResponse.json({ ok: true, database: "connected" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
