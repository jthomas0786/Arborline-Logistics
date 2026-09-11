ALTER TABLE carriers ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS verified_legal_name text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS legal_name_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS carrier_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  contact_email text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','EXPIRED','REVOKED')),
  carrier_id uuid REFERENCES carriers(id),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_invites_token_idx ON carrier_invites(public_token);

CREATE TABLE IF NOT EXISTS carrier_equipment_profiles (
  carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  equipment_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carrier_id,equipment_type)
);

CREATE TABLE IF NOT EXISTS carrier_verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'WEBHOOK',
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','WAITING_PROVIDER','PASSED','REVIEW','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  authority_status text,
  insurance_status text,
  verified_legal_name text,
  legal_name_match boolean,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_verification_queue_idx ON carrier_verification_checks(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS carrier_verification_carrier_idx ON carrier_verification_checks(carrier_id,created_at DESC);

CREATE TABLE IF NOT EXISTS app_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('STAFF','SHIPPER','CARRIER')),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  shipper_id uuid REFERENCES shippers(id) ON DELETE SET NULL,
  carrier_id uuid REFERENCES carriers(id) ON DELETE SET NULL,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    role='STAFF' OR
    (role='SHIPPER' AND shipper_id IS NOT NULL) OR
    (role='CARRIER' AND carrier_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users(role,is_active);
CREATE INDEX IF NOT EXISTS app_users_org_idx ON app_users(organization_id);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_equipment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_verification_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_users FROM anon, authenticated;
REVOKE ALL ON carrier_invites FROM anon, authenticated;
REVOKE ALL ON carrier_equipment_profiles FROM anon, authenticated;
REVOKE ALL ON carrier_verification_checks FROM anon, authenticated;
