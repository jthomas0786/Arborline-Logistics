ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS connect_client_id uuid REFERENCES connect_clients(id) ON DELETE SET NULL;

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_check;

ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('STAFF','SHIPPER','CARRIER','CONNECT_CLIENT'));

ALTER TABLE app_users
  ADD CONSTRAINT app_users_check
  CHECK (
    role='STAFF' OR
    (role='SHIPPER' AND shipper_id IS NOT NULL) OR
    (role='CARRIER' AND carrier_id IS NOT NULL) OR
    (role='CONNECT_CLIENT' AND connect_client_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS app_users_connect_client_idx
  ON app_users(connect_client_id)
  WHERE connect_client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_client_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLAIMED','REVOKED','EXPIRED')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_client_invites_active_email_uq
  ON connect_client_invites(lower(email))
  WHERE status='PENDING';

CREATE INDEX IF NOT EXISTS connect_client_invites_client_idx
  ON connect_client_invites(client_id, status, created_at DESC);

ALTER TABLE connect_client_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON connect_client_invites FROM anon, authenticated;
