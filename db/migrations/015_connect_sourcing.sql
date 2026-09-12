CREATE TABLE IF NOT EXISTS connect_sourcing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'EXTERNAL',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','NEEDS_PROVIDER')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  qualified_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_sourcing_runs_client_idx ON connect_sourcing_runs(client_id, created_at DESC);
ALTER TABLE connect_sourcing_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON connect_sourcing_runs FROM anon, authenticated;
