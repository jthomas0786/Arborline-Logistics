CREATE TABLE IF NOT EXISTS connect_worker_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES connect_clients(id) ON DELETE CASCADE,
  worker_type text NOT NULL CHECK (worker_type IN ('SOURCE','ENRICH','QUALIFY','OUTREACH_PREPARE','FOLLOW_UP','REPLY_CLASSIFY','HANDOFF','HEALTH')),
  mode text NOT NULL DEFAULT 'DRY_RUN' CHECK (mode IN ('DRY_RUN','ACTIVE')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','RETRY','SUCCEEDED','BLOCKED','FAILED','CANCELLED')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS connect_worker_jobs_due_idx
  ON connect_worker_jobs(status, run_at, priority, created_at)
  WHERE status IN ('QUEUED','RETRY');
CREATE INDEX IF NOT EXISTS connect_worker_jobs_client_idx
  ON connect_worker_jobs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_worker_jobs_locked_idx
  ON connect_worker_jobs(status, locked_at)
  WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS connect_worker_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES connect_worker_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  worker_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','RETRY','BLOCKED','FAILED')),
  result jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_id, attempt)
);

CREATE INDEX IF NOT EXISTS connect_worker_runs_job_idx
  ON connect_worker_runs(job_id, attempt DESC);
CREATE INDEX IF NOT EXISTS connect_worker_runs_started_idx
  ON connect_worker_runs(started_at DESC);

ALTER TABLE connect_worker_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_worker_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_worker_jobs FROM anon, authenticated;
REVOKE ALL ON connect_worker_runs FROM anon, authenticated;
