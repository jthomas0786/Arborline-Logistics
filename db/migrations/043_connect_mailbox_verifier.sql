-- ArborLine-owned mailbox verification foundation.
-- This migration only creates verifier state/history and a worker lane.
-- It does not verify, promote, draft, approve, queue, or send outreach.

ALTER TABLE connect_worker_jobs
  DROP CONSTRAINT IF EXISTS connect_worker_jobs_worker_type_check;

ALTER TABLE connect_worker_jobs
  ADD CONSTRAINT connect_worker_jobs_worker_type_check
  CHECK (worker_type IN (
    'SOURCE',
    'RESEARCH',
    'NATIVE_ENRICH',
    'MAILBOX_VERIFY',
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

CREATE TABLE IF NOT EXISTS connect_mailbox_domain_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  domain text NOT NULL,
  last_status text NOT NULL DEFAULT 'NOT_CHECKED' CHECK (last_status IN (
    'NOT_CHECKED','VERIFIED','INVALID','CATCH_ALL','TEMPORARY','UNKNOWN','NETWORK_BLOCKED','DEFERRED'
  )),
  catch_all_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (catch_all_status IN (
    'UNKNOWN','NOT_CATCH_ALL','CATCH_ALL','TEMPORARY'
  )),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_probe_at timestamptz,
  last_success_at timestamptz,
  next_probe_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_mailbox_domain_state_client_domain_uidx
  ON connect_mailbox_domain_state(client_id, lower(domain));
CREATE INDEX IF NOT EXISTS connect_mailbox_domain_state_due_idx
  ON connect_mailbox_domain_state(next_probe_at, consecutive_failures, updated_at);
CREATE INDEX IF NOT EXISTS connect_mailbox_domain_state_lock_idx
  ON connect_mailbox_domain_state(locked_at)
  WHERE locked_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_mailbox_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES connect_contact_candidates(id) ON DELETE SET NULL,
  prospect_id uuid REFERENCES connect_prospects(id) ON DELETE SET NULL,
  worker_job_id uuid REFERENCES connect_worker_jobs(id) ON DELETE SET NULL,
  email text NOT NULL,
  domain text NOT NULL,
  mx_host text,
  status text NOT NULL CHECK (status IN (
    'VERIFIED','INVALID','CATCH_ALL','TEMPORARY','UNKNOWN','NETWORK_BLOCKED','DEFERRED'
  )),
  smtp_code integer,
  response_excerpt text,
  catch_all_result text NOT NULL DEFAULT 'UNKNOWN' CHECK (catch_all_result IN (
    'UNKNOWN','NOT_CATCH_ALL','CATCH_ALL','TEMPORARY'
  )),
  tls_used boolean NOT NULL DEFAULT false,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_mailbox_verification_attempts_email_idx
  ON connect_mailbox_verification_attempts(client_id, lower(email), completed_at DESC);
CREATE INDEX IF NOT EXISTS connect_mailbox_verification_attempts_domain_idx
  ON connect_mailbox_verification_attempts(client_id, lower(domain), completed_at DESC);
CREATE INDEX IF NOT EXISTS connect_mailbox_verification_attempts_candidate_idx
  ON connect_mailbox_verification_attempts(candidate_id, completed_at DESC)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS connect_contact_candidates_mailbox_verify_idx
  ON connect_contact_candidates(client_id, email_status, identity_confidence DESC, email_confidence DESC, last_seen_at DESC)
  WHERE email IS NOT NULL AND email_status IN ('MX_VALID','TEMPORARY');

ALTER TABLE connect_mailbox_domain_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_mailbox_verification_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_mailbox_domain_state FROM anon, authenticated;
REVOKE ALL ON connect_mailbox_verification_attempts FROM anon, authenticated;
