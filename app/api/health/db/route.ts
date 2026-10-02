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

function safeConnectionMeta() {
  const raw = process.env.DATABASE_URL || "";
  if (!raw) return { configured: false };
  try {
    const url = new URL(raw);
    const decodedPassword = decodeURIComponent(url.password || "");
    return {
      configured: true,
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port || null,
      username: decodeURIComponent(url.username || ""),
      database: url.pathname.replace(/^\//, "") || null,
      passwordConfigured: Boolean(url.password),
      passwordPlaceholder: /your[-_ ]?password|password_here|\[.*password.*\]/i.test(decodedPassword)
    };
  } catch {
    return { configured: true, parseable: false };
  }
}

export async function GET() {
  const connection = safeConnectionMeta();
  try {
    await getPool().query("select 1");
    return NextResponse.json(
      { ok: true, database: "connected", connection },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, database: "unavailable", connection, error: safeError(error) },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
