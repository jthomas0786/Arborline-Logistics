ALTER TABLE connect_outreach_messages
  ADD COLUMN IF NOT EXISTS experiment_key text,
  ADD COLUMN IF NOT EXISTS experiment_variant text,
  ADD COLUMN IF NOT EXISTS sample_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_view_count integer NOT NULL DEFAULT 0;

ALTER TABLE connect_outreach_messages
  DROP CONSTRAINT IF EXISTS connect_outreach_messages_experiment_variant_check;
ALTER TABLE connect_outreach_messages
  ADD CONSTRAINT connect_outreach_messages_experiment_variant_check
  CHECK (experiment_variant IS NULL OR experiment_variant IN ('CONTROL','SAMPLES_LINK'));

ALTER TABLE connect_outreach_messages
  DROP CONSTRAINT IF EXISTS connect_outreach_messages_sample_view_count_check;
ALTER TABLE connect_outreach_messages
  ADD CONSTRAINT connect_outreach_messages_sample_view_count_check
  CHECK (sample_view_count >= 0);

CREATE INDEX IF NOT EXISTS connect_outreach_messages_experiment_idx
  ON connect_outreach_messages(experiment_key, experiment_variant, created_at DESC)
  WHERE experiment_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS connect_outreach_messages_sample_viewed_idx
  ON connect_outreach_messages(sample_viewed_at DESC)
  WHERE sample_viewed_at IS NOT NULL;
