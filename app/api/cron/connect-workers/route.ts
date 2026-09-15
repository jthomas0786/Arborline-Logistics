import { NextResponse } from "next/server";
import { dispatchConnectQueuedOutreach } from "@/lib/connect-outreach-send";
import { processConnectWorkerJobs } from "@/lib/connect-workers";

function chicagoHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

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

    const localHour = chicagoHour(startedAt);
    const outreach = localHour === 9
      ? await dispatchConnectQueuedOutreach()
      : { skipped: true, reason: "Scheduled outreach only dispatches during the 9 AM America/Chicago hour." };

    return NextResponse.json({
      ok: true,
      ...result,
      outreach,
      schedule: { timeZone: "America/Chicago", localHour, dispatchHour: 9 },
      ranAt: startedAt.toISOString()
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Connect worker cron failed", ranAt: startedAt.toISOString() }, { status: 500 });
  }
}
