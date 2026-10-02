import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";

type Attempt = { ok: boolean; code?: string; message?: string };

function safeError(error: unknown): Attempt {
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    ok: false,
    code: typeof value?.code === "string" ? value.code : "unknown",
    message: typeof value?.message === "string" ? value.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]").slice(0,180) : "unknown"
  };
}

async function tryConnection(connectionString: string): Promise<Attempt> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 7000, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true };
  } catch (error) {
    return safeError(error);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function GET() {
  const raw = process.env.DATABASE_URL || "";
  if (!raw) return NextResponse.json({ ok: false, configured: false }, { status: 503 });

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, configured: true, parseable: false }, { status: 503 });
  }

  const pooler = await tryConnection(raw);
  const direct = new URL(raw);
  direct.hostname = "db.bjqkmcsduhazieuzegqi.supabase.co";
  direct.port = "5432";
  direct.username = "postgres";
  const directResult = await tryConnection(direct.toString());

  return NextResponse.json(
    {
      ok: pooler.ok || directResult.ok,
      pooler,
      direct: directResult,
      poolerHost: parsed.hostname,
      poolerUser: decodeURIComponent(parsed.username || "")
    },
    { status: pooler.ok || directResult.ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
