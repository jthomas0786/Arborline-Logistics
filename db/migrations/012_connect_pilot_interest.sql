CREATE TABLE IF NOT EXISTS connect_pilot_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  work_email text NOT NULL,
  company_name text NOT NULL,
  industry text,
  service_area text,
  website text,
  notes text,
  source text NOT NULL DEFAULT 'WEBSITE',
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','NOT_A_FIT','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_pilot_interest_status_idx ON connect_pilot_interest(status, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_pilot_interest_email_idx ON connect_pilot_interest(lower(work_email));

ALTER TABLE connect_pilot_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE connect_pilot_interest FROM anon, authenticated;
