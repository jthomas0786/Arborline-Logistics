ALTER TABLE connect_clients
  ADD COLUMN IF NOT EXISTS primary_contact_phone text,
  ADD COLUMN IF NOT EXISTS services_offered text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS business_address_line1 text,
  ADD COLUMN IF NOT EXISTS business_address_line2 text,
  ADD COLUMN IF NOT EXISTS business_city text,
  ADD COLUMN IF NOT EXISTS business_state text,
  ADD COLUMN IF NOT EXISTS business_postal_code text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS connect_clients_onboarding_status_idx
  ON connect_clients(status, onboarding_completed_at, updated_at DESC);
