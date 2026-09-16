import { NextResponse } from "next/server";
import { runPublicDiscoveryCycle } from "@/lib/connect-public-discovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  const result = await runPublicDiscoveryCycle(startedAt);
  const status = result.state === "FAILED" ? 502 : 200;
  return NextResponse.json({
    ok: result.state !== "FAILED",
    result,
    schedule: {
      cadence: "hourly",
      mode: "rotating active segment/geography slot",
      outreachSeparated: true
    },
    ranAt: startedAt.toISOString()
  }, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
