CREATE TABLE IF NOT EXISTS connect_client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_email text,
  category text NOT NULL DEFAULT 'TARGETING' CHECK (category IN ('TARGETING','PROFILE','TEAM_ACCESS','OTHER')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','IN_REVIEW','COMPLETED','DECLINED')),
  staff_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_client_requests_client_status_idx
  ON connect_client_requests(client_id,status,created_at DESC);

ALTER TABLE connect_client_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON connect_client_requests FROM anon, authenticated;
