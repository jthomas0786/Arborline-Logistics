import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { processConnectWorkerJobs, type ConnectWorkerType } from "@/lib/connect-workers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_WORKERS = new Set<ConnectWorkerType>([
  "SOURCE",
  "ENRICH",
  "QUALIFY",
  "OUTREACH_PREPARE"
]);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "referrer-policy": "no-referrer"
    }
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || token.length < 32 || token.length > 200) {
    return response({ error: "Invalid one-shot worker request." }, 400);
  }

  const pool = getPool();
  const jobResult = await pool.query(
    `SELECT id,client_id,worker_type,mode,status,payload
     FROM connect_worker_jobs
     WHERE id=$1 AND mode='ACTIVE'
     LIMIT 1`,
    [jobId]
  );
  const job = jobResult.rows[0];
  if (!job) return response({ error: "One-shot worker job not found." }, 404);
  if (!ALLOWED_WORKERS.has(job.worker_type as ConnectWorkerType)) return response({ error: "Worker type is not allowed for one-shot execution." }, 409);
  if (!['QUEUED','RETRY'].includes(job.status)) return response({ error: "One-shot worker job is no longer available.", status: job.status }, 409);

  const expectedHash = typeof job.payload?.trigger_token_hash === "string" ? job.payload.trigger_token_hash : "";
  if (!safeEqualHex(sha256(token), expectedHash)) return response({ error: "Unauthorized." }, 401);

  const expiresAt = typeof job.payload?.expires_at === "string" ? Date.parse(job.payload.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await pool.query(
      `UPDATE connect_worker_jobs
       SET last_error='One-shot worker trigger expired',updated_at=now(),payload=payload-'trigger_token_hash'
       WHERE id=$1`,
      [jobId]
    );
    return response({ error: "One-shot worker trigger expired." }, 410);
  }

  try {
    const result = await processConnectWorkerJobs({
      limit: 1,
      workerId: `one-shot-${String(job.worker_type).toLowerCase()}`,
      jobId
    });
    if (result.claimed !== 1) return response({ error: "One-shot worker job could not be claimed.", result }, 409);
    return response({ ok: true, result });
  } finally {
    await pool.query(
      `UPDATE connect_worker_jobs SET payload=payload-'trigger_token_hash',updated_at=now() WHERE id=$1`,
      [jobId]
    );
  }
}
