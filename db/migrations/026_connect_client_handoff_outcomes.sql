ALTER TABLE connect_handoffs
  ADD COLUMN IF NOT EXISTS client_outcome text,
  ADD COLUMN IF NOT EXISTS outcome_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE connect_handoffs
  DROP CONSTRAINT IF EXISTS connect_handoffs_client_outcome_check;

ALTER TABLE connect_handoffs
  ADD CONSTRAINT connect_handoffs_client_outcome_check
  CHECK (client_outcome IS NULL OR client_outcome IN ('FOLLOW_UP_NEEDED','ESTIMATE_SENT','WON','LOST'));

CREATE INDEX IF NOT EXISTS connect_handoffs_client_outcome_idx
  ON connect_handoffs(client_id, client_outcome, updated_at DESC);
