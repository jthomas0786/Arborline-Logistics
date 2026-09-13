import { NextResponse } from "next/server";
import { processConnectWorkerJobs } from "@/lib/connect-workers";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await processConnectWorkerJobs({
      limit: Number(process.env.CONNECT_WORKER_BATCH_LIMIT ?? 10),
      workerId: "vercel-connect-cron"
    });
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connect worker cron failed" }, { status: 500 });
  }
}
