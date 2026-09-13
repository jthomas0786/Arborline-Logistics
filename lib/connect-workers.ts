import { randomUUID } from "crypto";
import { getPool } from "@/lib/db";
import { runConnectSourcing, sourcingProvider } from "@/lib/connect-source-runner";
import { contactEnrichmentProvider, enrichQualifiedProspects } from "@/lib/connect-contact-enrichment";
import { scoreConnectProspect, type ConnectIcpProfile } from "@/lib/connect-prospect-scoring";
import { prepareConnectOutreachDrafts, previewConnectOutreachDrafts } from "@/lib/connect-outreach-drafts";
import {
  classifyPendingConnectReplies,
  createConnectHandoffs,
  previewConnectHandoffs,
  previewPendingConnectReplies
} from "@/lib/connect-replies";

export type ConnectWorkerType =
  | "SOURCE"
  | "ENRICH"
  | "QUALIFY"
  | "OUTREACH_PREPARE"
  | "FOLLOW_UP"
  | "REPLY_CLASSIFY"
  | "HANDOFF"
  | "HEALTH";

export type ConnectWorkerMode = "DRY_RUN" | "ACTIVE";

type WorkerJob = {
  id: string;
  client_id: string | null;
  worker_type: ConnectWorkerType;
  mode: ConnectWorkerMode;
  status: string;
  priority: number;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

type ProcessWorkerOptions = {
  limit?: number;
  workerId?: string;
  clientId?: string;
  mode?: ConnectWorkerMode;
  workerTypes?: ConnectWorkerType[];
};

class WorkerBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerBlockedError";
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function workersEnabled() {
  return process.env.CONNECT_WORKERS_ENABLED === "true";
}

function providerSpendEnabled() {
  return process.env.CONNECT_WORKERS_PROVIDER_SPEND_ENABLED === "true";
}

function requireActiveWorker({ providerSpend = false } = {}) {
  if (!workersEnabled()) throw new WorkerBlockedError("Connect active workers are disabled by the master switch.");
  if (providerSpend && !providerSpendEnabled()) throw new WorkerBlockedError("Provider-spend workers are disabled by the provider-spend switch.");
}

export async function queueConnectWorkerJob(input: {
  clientId?: string | null;
  workerType: ConnectWorkerType;
  mode?: ConnectWorkerMode;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
}) {
  const pool = getPool();
  const key = input.idempotencyKey.trim().slice(0, 240);
  if (!key) throw new Error("Worker idempotency key is required.");

  const params = [
    input.clientId ?? null,
    input.workerType,
    input.mode ?? "DRY_RUN",
    clamp(input.priority, 1, 1000, 100),
    input.runAt ?? new Date(),
    clamp(input.maxAttempts, 1, 20, 5),
    key,
    JSON.stringify(input.payload ?? {})
  ];

  const inserted = await pool.query(
    `INSERT INTO connect_worker_jobs (client_id,worker_type,mode,priority,run_at,max_attempts,idempotency_key,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id,client_id,worker_type,mode,status,run_at,idempotency_key`,
    params
  );
  if (inserted.rows[0]) return { ...inserted.rows[0], created: true };

  const existing = await pool.query(
    `SELECT id,client_id,worker_type,mode,status,run_at,idempotency_key
     FROM connect_worker_jobs WHERE idempotency_key=$1 LIMIT 1`,
    [key]
  );
  return { ...existing.rows[0], created: false };
}

export async function queueConnectPipeline(clientId: string, mode: ConnectWorkerMode = "DRY_RUN") {
  const window = Math.floor(Date.now() / (15 * 60_000));
  return queueConnectWorkerJob({
    clientId,
    workerType: "SOURCE",
    mode,
    priority: 20,
    idempotencyKey: `connect-pipeline:${clientId}:${mode}:${window}`,
    payload: { pipeline: true }
  });
}

async function queueNext(job: WorkerJob, workerType: ConnectWorkerType, priority: number, payload: Record<string, unknown> = {}) {
  if (!job.client_id) return null;
  return queueConnectWorkerJob({
    clientId: job.client_id,
    workerType,
    mode: job.mode,
    priority,
    idempotencyKey: `${job.idempotency_key}:${workerType.toLowerCase()}`,
    payload: { pipeline: true, ...payload }
  });
}

async function previewSourcing(clientId: string) {
  const pool = getPool();
  const client = await pool.query(
    `SELECT c.id,c.company_name,i.target_industries,i.target_geographies,i.minimum_score
     FROM connect_clients c JOIN connect_icp_profiles i ON i.client_id=c.id WHERE c.id=$1`,
    [clientId]
  );
  if (!client.rows[0]) throw new Error("Client ICP not found.");
  return {
    dryRun: true,
    provider: sourcingProvider(),
    company: client.rows[0].company_name,
    targetIndustries: client.rows[0].target_industries ?? [],
    targetGeographies: client.rows[0].target_geographies ?? [],
    minimumScore: client.rows[0].minimum_score ?? 70,
    externalProviderCalled: false
  };
}

async function previewEnrichment(clientId: string, limit: number) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT count(*)::int AS eligible
     FROM connect_prospects
     WHERE client_id=$1 AND qualification_status='QUALIFIED' AND enrichment_status='PARTIAL'
       AND contact_email IS NULL AND domain IS NOT NULL`,
    [clientId]
  );
  return {
    dryRun: true,
    provider: contactEnrichmentProvider(),
    eligible: result.rows[0]?.eligible ?? 0,
    limit,
    externalProviderCalled: false
  };
}

async function previewQualification(clientId: string, limit: number) {
  const result = await getPool().query(
    `SELECT count(*)::int AS eligible FROM connect_prospects
     WHERE client_id=$1 AND qualification_status IN ('PENDING','REVIEW','QUALIFIED')
       AND (last_scored_at IS NULL OR updated_at > last_scored_at)`,
    [clientId]
  );
  return { dryRun: true, eligible: result.rows[0]?.eligible ?? 0, limit, recordsChanged: false };
}

async function qualifyClientProspects(clientId: string, limit: number) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.*,
      i.target_industries,i.target_geographies,i.min_employees,i.max_employees,
      i.min_locations,i.max_locations,i.facility_types,i.decision_maker_titles,
      i.buying_signals AS icp_buying_signals,i.exclusions,i.minimum_score,
      EXISTS (
        SELECT 1 FROM connect_suppressions s
        WHERE (s.client_id IS NULL OR s.client_id=p.client_id)
          AND ((s.email IS NOT NULL AND lower(s.email)=lower(p.contact_email))
            OR (s.domain IS NOT NULL AND lower(s.domain)=lower(p.domain)))
      ) AS is_suppressed
     FROM connect_prospects p
     JOIN connect_icp_profiles i ON i.client_id=p.client_id
     WHERE p.client_id=$1
       AND p.qualification_status IN ('PENDING','REVIEW','QUALIFIED')
       AND (p.last_scored_at IS NULL OR p.updated_at > p.last_scored_at)
     ORDER BY p.created_at ASC
     LIMIT $2`,
    [clientId, limit]
  );

  const counts = { scored: 0, qualified: 0, review: 0, rejected: 0, suppressed: 0 };
  for (const row of rows) {
    const suppression = row.is_suppressed ? "DO_NOT_CONTACT" : row.suppression_status;
    const scoring = scoreConnectProspect(
      {
        company_name: row.company_name,
        domain: row.domain,
        industry: row.industry,
        city: row.city,
        state: row.state,
        country: row.country,
        employee_count: row.employee_count,
        location_count: row.location_count,
        facility_type: row.facility_type,
        contact_title: row.contact_title,
        buying_signals: row.buying_signals,
        suppression_status: suppression
      },
      {
        target_industries: row.target_industries ?? [],
        target_geographies: row.target_geographies ?? [],
        min_employees: row.min_employees,
        max_employees: row.max_employees,
        min_locations: row.min_locations,
        max_locations: row.max_locations,
        facility_types: row.facility_types ?? [],
        decision_maker_titles: row.decision_maker_titles ?? [],
        buying_signals: row.icp_buying_signals ?? [],
        exclusions: row.exclusions ?? [],
        minimum_score: row.minimum_score ?? 70
      } satisfies ConnectIcpProfile
    );

    const nextOutreach = scoring.status === "QUALIFIED" && row.contact_email ? "READY" : "NOT_READY";
    await pool.query(
      `UPDATE connect_prospects
       SET qualification_score=$2,
           qualification_status=$3,
           qualification_reasons=$4::jsonb,
           suppression_status=$5,
           outreach_status=CASE
             WHEN outreach_status IN ('CONTACTED','REPLIED','BOOKED','STOPPED') THEN outreach_status
             WHEN $3='SUPPRESSED' THEN 'STOPPED'
             ELSE $6
           END,
           last_scored_at=now(),updated_at=now()
       WHERE id=$1`,
      [row.id, scoring.score, scoring.status, JSON.stringify(scoring.reasons), suppression, nextOutreach]
    );

    counts.scored++;
    if (scoring.status === "QUALIFIED") counts.qualified++;
    else if (scoring.status === "REVIEW") counts.review++;
    else if (scoring.status === "SUPPRESSED") counts.suppressed++;
    else counts.rejected++;
  }
  return counts;
}

async function seedPendingConversationWork() {
  if (!workersEnabled()) return { replyJobs: 0, handoffJobs: 0 };
  const pool = getPool();
  let replyJobs = 0;
  let handoffJobs = 0;
  try {
    const pendingReplies = await pool.query(
      `SELECT DISTINCT ON (client_id) client_id,id
       FROM connect_replies
       WHERE client_id IS NOT NULL AND match_status='MATCHED' AND classification_status='PENDING'
       ORDER BY client_id,received_at ASC`
    );
    for (const row of pendingReplies.rows) {
      const queued = await queueConnectWorkerJob({
        clientId: row.client_id,
        workerType: "REPLY_CLASSIFY",
        mode: "ACTIVE",
        priority: 5,
        idempotencyKey: `connect-reply-classify:${row.client_id}:${row.id}`,
        payload: { limit: 25 }
      });
      if (queued.created) replyJobs++;
    }

    const pendingHandoffs = await pool.query(
      `SELECT DISTINCT ON (r.client_id) r.client_id,r.id
       FROM connect_replies r
       WHERE r.client_id IS NOT NULL AND r.classification='INTERESTED'
         AND NOT EXISTS (SELECT 1 FROM connect_handoffs h WHERE h.reply_id=r.id)
       ORDER BY r.client_id,r.received_at ASC`
    );
    for (const row of pendingHandoffs.rows) {
      const queued = await queueConnectWorkerJob({
        clientId: row.client_id,
        workerType: "HANDOFF",
        mode: "ACTIVE",
        priority: 6,
        idempotencyKey: `connect-handoff:${row.id}`,
        payload: { replyId: row.id, limit: 1 }
      });
      if (queued.created) handoffJobs++;
    }
  } catch (error) {
    if ((error as { code?: string })?.code !== "42P01") throw error;
  }
  return { replyJobs, handoffJobs };
}

async function workerHealth(clientId: string | null) {
  const pool = getPool();
  const params: unknown[] = [];
  const clientClause = clientId ? (params.push(clientId), `AND client_id=$${params.length}`) : "";
  const jobs = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status='QUEUED')::int AS queued,
       count(*) FILTER (WHERE status='RETRY')::int AS retrying,
       count(*) FILTER (WHERE status='RUNNING')::int AS running,
       count(*) FILTER (WHERE status='FAILED')::int AS failed,
       count(*) FILTER (WHERE status='BLOCKED')::int AS blocked
     FROM connect_worker_jobs WHERE true ${clientClause}`,
    params
  );
  return { ...(jobs.rows[0] ?? {}), checkedAt: new Date().toISOString() };
}

async function executeJob(job: WorkerJob) {
  if (!job.client_id && job.worker_type !== "HEALTH") throw new Error(`${job.worker_type} worker requires a client.`);
  const limit = clamp(job.payload?.limit, 1, 50, job.worker_type === "ENRICH" ? 10 : 25);

  if (job.worker_type === "SOURCE") {
    const result = job.mode === "DRY_RUN"
      ? await previewSourcing(job.client_id as string)
      : (requireActiveWorker({ providerSpend: true }), await runConnectSourcing(job.client_id as string));
    if (job.payload?.pipeline !== false) await queueNext(job, "ENRICH", 30, { limit: 10 });
    return result;
  }

  if (job.worker_type === "ENRICH") {
    const result = job.mode === "DRY_RUN"
      ? await previewEnrichment(job.client_id as string, limit)
      : (requireActiveWorker({ providerSpend: true }), await enrichQualifiedProspects(job.client_id as string, limit));
    if (job.payload?.pipeline !== false) await queueNext(job, "QUALIFY", 40, { limit: 25 });
    return result;
  }

  if (job.worker_type === "QUALIFY") {
    const result = job.mode === "DRY_RUN"
      ? await previewQualification(job.client_id as string, limit)
      : (requireActiveWorker(), await qualifyClientProspects(job.client_id as string, limit));
    if (job.payload?.pipeline !== false) await queueNext(job, "OUTREACH_PREPARE", 50, { limit: 25 });
    return result;
  }

  if (job.worker_type === "OUTREACH_PREPARE") {
    if (job.mode === "DRY_RUN") return previewConnectOutreachDrafts(job.client_id as string, limit);
    requireActiveWorker();
    return prepareConnectOutreachDrafts(job.client_id as string, limit);
  }

  if (job.worker_type === "REPLY_CLASSIFY") {
    if (job.mode === "DRY_RUN") return previewPendingConnectReplies(job.client_id as string, limit);
    requireActiveWorker();
    const result = await classifyPendingConnectReplies(job.client_id as string, limit);
    for (const replyId of result.interested) {
      await queueConnectWorkerJob({
        clientId: job.client_id,
        workerType: "HANDOFF",
        mode: "ACTIVE",
        priority: 6,
        idempotencyKey: `connect-handoff:${replyId}`,
        payload: { replyId, limit: 1 }
      });
    }
    return result;
  }

  if (job.worker_type === "HANDOFF") {
    const replyId = typeof job.payload?.replyId === "string" ? job.payload.replyId : null;
    if (job.mode === "DRY_RUN") return previewConnectHandoffs(job.client_id as string, replyId);
    requireActiveWorker();
    return createConnectHandoffs(job.client_id as string, limit, replyId);
  }

  if (job.worker_type === "HEALTH") return workerHealth(job.client_id);

  if (job.worker_type === "FOLLOW_UP") {
    throw new WorkerBlockedError("Follow-up automation stays locked until the first production outreach and reply flow are validated.");
  }

  throw new WorkerBlockedError(`${job.worker_type} worker is reserved for a later automation release and cannot execute yet.`);
}

async function recoverStaleJobs() {
  return getPool().query(
    `UPDATE connect_worker_jobs
     SET status='RETRY',run_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,
         last_error='Recovered after stale worker lock.',updated_at=now()
     WHERE status='RUNNING' AND locked_at < now() - interval '15 minutes'`
  );
}

async function claimJob(workerId: string, options: Pick<ProcessWorkerOptions,"clientId"|"mode"|"workerTypes">): Promise<WorkerJob | null> {
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const params: unknown[] = [];
    const clauses = [`status IN ('QUEUED','RETRY')`, `run_at <= now()`];
    if (options.clientId) {
      params.push(options.clientId);
      clauses.push(`client_id=$${params.length}`);
    }
    if (options.mode) {
      params.push(options.mode);
      clauses.push(`mode=$${params.length}`);
    }
    if (options.workerTypes?.length) {
      params.push(options.workerTypes);
      clauses.push(`worker_type=ANY($${params.length}::text[])`);
    }
    const selected = await db.query(
      `SELECT * FROM connect_worker_jobs
       WHERE ${clauses.join(" AND ")}
       ORDER BY priority ASC,run_at ASC,created_at ASC
       FOR UPDATE SKIP LOCKED LIMIT 1`,
      params
    );
    const row = selected.rows[0];
    if (!row) {
      await db.query("COMMIT");
      return null;
    }
    const attempts = Number(row.attempts ?? 0) + 1;
    const updated = await db.query(
      `UPDATE connect_worker_jobs
       SET status='RUNNING',attempts=$2,locked_at=now(),locked_by=$3,heartbeat_at=now(),
           started_at=coalesce(started_at,now()),last_error=NULL,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [row.id, attempts, workerId]
    );
    await db.query(
      `INSERT INTO connect_worker_runs(job_id,attempt,worker_id,status)
       VALUES($1,$2,$3,'RUNNING')`,
      [row.id, attempts, workerId]
    );
    await db.query("COMMIT");
    return updated.rows[0] as WorkerJob;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function completeJob(job: WorkerJob, result: unknown) {
  const pool = getPool();
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status='SUCCEEDED',result=$2::jsonb,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, JSON.stringify(result ?? {})]
  );
  await pool.query(
    `UPDATE connect_worker_runs SET status='SUCCEEDED',result=$3::jsonb,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, JSON.stringify(result ?? {})]
  );
}

async function blockJob(job: WorkerJob, error: Error) {
  const pool = getPool();
  const message = error.message.slice(0, 1000);
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status='BLOCKED',last_error=$2,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, message]
  );
  await pool.query(
    `UPDATE connect_worker_runs SET status='BLOCKED',error_message=$3,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, message]
  );
}

async function failJob(job: WorkerJob, error: unknown) {
  const pool = getPool();
  const message = (error instanceof Error ? error.message : "Unknown worker error").slice(0, 1000);
  const retry = job.attempts < job.max_attempts;
  const delaySeconds = Math.min(1800, 30 * Math.pow(2, Math.max(0, job.attempts - 1)));
  await pool.query(
    `UPDATE connect_worker_jobs
     SET status=$2,last_error=$3,run_at=CASE WHEN $2='RETRY' THEN now() + ($4 * interval '1 second') ELSE run_at END,
         completed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END,
         locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,updated_at=now()
     WHERE id=$1`,
    [job.id, retry ? "RETRY" : "FAILED", message, delaySeconds]
  );
  await pool.query(
    `UPDATE connect_worker_runs SET status=$3,error_message=$4,completed_at=now()
     WHERE job_id=$1 AND attempt=$2`,
    [job.id, job.attempts, retry ? "RETRY" : "FAILED", message]
  );
  return retry;
}

export async function processConnectWorkerJobs(options: ProcessWorkerOptions = {}) {
  const limit = clamp(options.limit ?? process.env.CONNECT_WORKER_BATCH_LIMIT, 1, 20, 5);
  const workerId = (options.workerId || `connect-${randomUUID()}`).slice(0, 160);
  await recoverStaleJobs();
  const shouldSeedConversations = options.mode !== "DRY_RUN" && (!options.workerTypes || options.workerTypes.some((type) => type === "REPLY_CLASSIFY" || type === "HANDOFF"));
  const seeded = shouldSeedConversations ? await seedPendingConversationWork() : { replyJobs: 0, handoffJobs: 0 };

  const summary = { workerId, seeded, claimed: 0, succeeded: 0, retried: 0, blocked: 0, failed: 0, jobs: [] as Array<Record<string, unknown>> };
  for (let index = 0; index < limit; index++) {
    const job = await claimJob(workerId, options);
    if (!job) break;
    summary.claimed++;
    try {
      const result = await executeJob(job);
      await completeJob(job, result);
      summary.succeeded++;
      summary.jobs.push({ id: job.id, type: job.worker_type, mode: job.mode, status: "SUCCEEDED", result });
    } catch (error) {
      if (error instanceof WorkerBlockedError) {
        await blockJob(job, error);
        summary.blocked++;
        summary.jobs.push({ id: job.id, type: job.worker_type, mode: job.mode, status: "BLOCKED", error: error.message });
      } else {
        const retry = await failJob(job, error);
        if (retry) summary.retried++;
        else summary.failed++;
        summary.jobs.push({ id: job.id, type: job.worker_type, mode: job.mode, status: retry ? "RETRY" : "FAILED", error: error instanceof Error ? error.message : "Unknown worker error" });
      }
    }
  }
  return summary;
}

export async function getConnectWorkerSummary(clientId: string) {
  const { rows } = await getPool().query(
    `SELECT
       count(*) FILTER (WHERE status='QUEUED')::int AS queued,
       count(*) FILTER (WHERE status='RUNNING')::int AS running,
       count(*) FILTER (WHERE status='RETRY')::int AS retrying,
       count(*) FILTER (WHERE status='SUCCEEDED')::int AS succeeded,
       count(*) FILTER (WHERE status='BLOCKED')::int AS blocked,
       count(*) FILTER (WHERE status='FAILED')::int AS failed,
       max(completed_at) AS last_completed_at,
       (SELECT worker_type FROM connect_worker_jobs j2 WHERE j2.client_id=$1 ORDER BY j2.created_at DESC LIMIT 1) AS latest_worker,
       (SELECT status FROM connect_worker_jobs j3 WHERE j3.client_id=$1 ORDER BY j3.created_at DESC LIMIT 1) AS latest_status
     FROM connect_worker_jobs WHERE client_id=$1`,
    [clientId]
  );
  return rows[0] ?? { queued: 0, running: 0, retrying: 0, succeeded: 0, blocked: 0, failed: 0, last_completed_at: null, latest_worker: null, latest_status: null };
}
