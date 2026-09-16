import { NextResponse } from "next/server";
import { processConnectWorkerJobs } from "@/lib/connect-workers";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const startedAt = new Date();
  try {
    const result = await processConnectWorkerJobs({
      limit: Number(process.env.CONNECT_WORKER_BATCH_LIMIT ?? 10),
      workerId: "vercel-connect-cron"
    });

    return NextResponse.json({
      ok: true,
      ...result,
      outreach: {
        skipped: true,
        reason: "Outreach dispatch is owned by the dedicated GitHub OIDC 9 AM scheduler."
      },
      ranAt: startedAt.toISOString()
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connect worker cron failed", ranAt: startedAt.toISOString() }, { status: 500 });
  }
}
