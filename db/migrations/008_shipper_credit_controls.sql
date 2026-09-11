ALTER TABLE shippers ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_contact_name text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_phone text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_address_line1 text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_address_line2 text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_city text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_state text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_postal_code text;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS credit_reviewed_at timestamptz;
ALTER TABLE shippers ADD COLUMN IF NOT EXISTS credit_reviewed_by uuid;

DO $$ BEGIN
  ALTER TABLE shippers ADD CONSTRAINT shippers_onboarding_status_check
    CHECK (onboarding_status IN ('PENDING','COMPLETE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE shippers ADD CONSTRAINT shippers_credit_status_check
    CHECK (credit_status IN ('PENDING','APPROVED','PREPAY','HOLD','DECLINED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shipper_credit_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipper_id uuid NOT NULL REFERENCES shippers(id) ON DELETE CASCADE,
  max_exposure numeric(12,2) NOT NULL CHECK (max_exposure >= 0),
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid
);
CREATE INDEX IF NOT EXISTS shipper_credit_overrides_active_idx
  ON shipper_credit_overrides(shipper_id,expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS shipper_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipper_id uuid NOT NULL REFERENCES shippers(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  credit_limit numeric(12,2),
  exposure_before numeric(12,2),
  requested_amount numeric(12,2),
  projected_exposure numeric(12,2),
  decision text,
  reason text,
  actor_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipper_credit_events_shipper_idx
  ON shipper_credit_events(shipper_id,created_at DESC);

ALTER TABLE shipper_credit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipper_credit_events ENABLE ROW LEVEL SECURITY;
