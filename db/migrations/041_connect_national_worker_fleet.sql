ALTER TABLE connect_worker_jobs
  DROP CONSTRAINT IF EXISTS connect_worker_jobs_worker_type_check;

ALTER TABLE connect_worker_jobs
  ADD CONSTRAINT connect_worker_jobs_worker_type_check
  CHECK (worker_type IN (
    'SOURCE',
    'RESEARCH',
    'NATIVE_ENRICH',
    'PROVIDER_ENRICH',
    'ENRICH',
    'QUALIFY',
    'OUTREACH_PREPARE',
    'COORDINATE',
    'FOLLOW_UP',
    'REPLY_CLASSIFY',
    'HANDOFF',
    'HEALTH'
  ));

ALTER TABLE connect_worker_jobs
  ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES connect_prospect_segments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES connect_research_markets(id) ON DELETE SET NULL;

UPDATE connect_worker_jobs
SET segment_id=(payload->>'segment_id')::uuid
WHERE segment_id IS NULL
  AND payload ? 'segment_id'
  AND (payload->>'segment_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE connect_worker_jobs
SET market_id=(payload->>'market_id')::uuid
WHERE market_id IS NULL
  AND payload ? 'market_id'
  AND (payload->>'market_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

CREATE INDEX IF NOT EXISTS connect_worker_jobs_market_segment_due_idx
  ON connect_worker_jobs(market_id,segment_id,status,priority,run_at,created_at)
  WHERE status IN ('QUEUED','RETRY','RUNNING');

CREATE INDEX IF NOT EXISTS connect_worker_jobs_type_due_idx
  ON connect_worker_jobs(worker_type,status,priority,run_at,created_at)
  WHERE status IN ('QUEUED','RETRY');
