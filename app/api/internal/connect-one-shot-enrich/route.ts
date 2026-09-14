import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { contactEnrichmentProvider, enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";

export const dynamic = "force-dynamic";

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
    return response({ error: "Invalid one-shot request." }, 400);
  }

  if (process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED !== "true") {
    return response({ error: "Provider-spend workers are disabled." }, 503);
  }
  if (contactEnrichmentProvider() !== "PROSPEO") {
    return response({ error: "Prospeo enrichment is not configured." }, 503);
  }

  const pool = getPool();
  const jobResult = await pool.query(
    `SELECT id,client_id,worker_type,mode,status,payload
     FROM connect_worker_jobs
     WHERE id=$1 AND worker_type='ENRICH' AND mode='ACTIVE'
     LIMIT 1`,
    [jobId]
  );
  const job = jobResult.rows[0];
  if (!job) return response({ error: "One-shot enrichment job not found." }, 404);
  if (job.status !== "QUEUED") return response({ error: "One-shot enrichment job is no longer available.", status: job.status }, 409);

  const expectedHash = typeof job.payload?.trigger_token_hash === "string" ? job.payload.trigger_token_hash : "";
  if (!safeEqualHex(sha256(token), expectedHash)) return response({ error: "Unauthorized." }, 401);

  const expiresAt = typeof job.payload?.expires_at === "string" ? Date.parse(job.payload.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    await pool.query(
      `UPDATE connect_worker_jobs
       SET status='FAILED',last_error='One-shot trigger expired',completed_at=now(),updated_at=now(),payload=payload-'trigger_token_hash'
       WHERE id=$1 AND status='QUEUED'`,
      [jobId]
    );
    return response({ error: "One-shot enrichment job expired." }, 410);
  }

  const segmentId = typeof job.payload?.segment_id === "string" ? job.payload.segment_id : "";
  const requestedLimit = Number(job.payload?.limit ?? 15);
  if (!segmentId || !Number.isFinite(requestedLimit) || requestedLimit < 1 || requestedLimit > 15) {
    return response({ error: "Invalid enrichment scope." }, 400);
  }

  const segment = await pool.query(
    `SELECT id,client_id,name,status
     FROM connect_prospect_segments
     WHERE id=$1 AND client_id=$2 AND status IN ('APPROVED','ACTIVE')
     LIMIT 1`,
    [segmentId, job.client_id]
  );
  if (!segment.rows[0]) return response({ error: "Approved prospect segment not found." }, 409);

  const eligible = await pool.query(
    `SELECT count(*)::int AS count
     FROM connect_prospects
     WHERE client_id=$1 AND segment_id=$2
       AND qualification_status='QUALIFIED'
       AND enrichment_status='PARTIAL'
       AND contact_email IS NULL
       AND domain IS NOT NULL`,
    [job.client_id, segmentId]
  );
  const eligibleCount = Number(eligible.rows[0]?.count ?? 0);
  if (eligibleCount < 1) return response({ error: "No eligible prospects remain for enrichment." }, 409);

  const claimed = await pool.query(
    `UPDATE connect_worker_jobs
     SET status='RUNNING',attempts=attempts+1,locked_at=now(),locked_by='one-shot-enrich',heartbeat_at=now(),started_at=coalesce(started_at,now()),updated_at=now()
     WHERE id=$1 AND status='QUEUED'
     RETURNING id`,
    [jobId]
  );
  if (!claimed.rows[0]) return response({ error: "One-shot enrichment job was already claimed." }, 409);

  try {
    const result = await enrichQualifiedProspects(job.client_id, Math.min(Math.floor(requestedLimit), eligibleCount), segmentId);
    await pool.query(
      `UPDATE connect_worker_jobs
       SET status='SUCCEEDED',result=$2::jsonb,last_error=NULL,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=now(),updated_at=now(),payload=payload-'trigger_token_hash'
       WHERE id=$1`,
      [jobId, JSON.stringify({ ...result, requestedLimit: Math.floor(requestedLimit), segmentId, eligibleAtStart: eligibleCount })]
    );
    return response({ ok: true, provider: "PROSPEO", segment: segment.rows[0].name, result });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown enrichment error";
    await pool.query(
      `UPDATE connect_worker_jobs
       SET status='FAILED',last_error=$2,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=now(),updated_at=now(),payload=payload-'trigger_token_hash'
       WHERE id=$1`,
      [jobId, message]
    );
    return response({ error: message }, 500);
  }
}
