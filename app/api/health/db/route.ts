import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeError(error: unknown) {
  if (!(error instanceof Error)) return { code: "unknown", message: "unknown" };
  const value = error as Error & { code?: string };
  const raw = error.message || "unknown";
  const message = raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-connection-string]")
    .replace(/password=[^\s]+/gi, "password=[redacted]")
    .slice(0, 220);
  return { code: value.code || "unknown", message };
}

export async function GET() {
  try {
    await getPool().query("select 1");
    return NextResponse.json({ ok: true, database: "connected" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, database: "unavailable", error: safeError(error) },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
