CREATE TABLE IF NOT EXISTS connect_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_interest_id uuid UNIQUE REFERENCES connect_pilot_interest(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  website text,
  industry text,
  primary_contact_name text,
  primary_contact_email text,
  service_summary text,
  service_area text,
  status text NOT NULL DEFAULT 'ONBOARDING' CHECK (status IN ('ONBOARDING','READY','ACTIVE','PAUSED','CLOSED')),
  booking_type text NOT NULL DEFAULT 'CALL' CHECK (booking_type IN ('CALL','ESTIMATE','DEMO','WALKTHROUGH','OTHER')),
  timezone text NOT NULL DEFAULT 'America/Chicago',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_clients_status_idx ON connect_clients(status, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_clients_company_idx ON connect_clients(lower(company_name));

CREATE TABLE IF NOT EXISTS connect_icp_profiles (
  client_id uuid PRIMARY KEY REFERENCES connect_clients(id) ON DELETE CASCADE,
  target_industries text[] NOT NULL DEFAULT '{}',
  target_geographies text[] NOT NULL DEFAULT '{}',
  min_employees integer CHECK (min_employees IS NULL OR min_employees >= 0),
  max_employees integer CHECK (max_employees IS NULL OR max_employees >= 0),
  min_locations integer CHECK (min_locations IS NULL OR min_locations >= 0),
  max_locations integer CHECK (max_locations IS NULL OR max_locations >= 0),
  facility_types text[] NOT NULL DEFAULT '{}',
  decision_maker_titles text[] NOT NULL DEFAULT '{}',
  buying_signals text[] NOT NULL DEFAULT '{}',
  exclusions text[] NOT NULL DEFAULT '{}',
  qualification_notes text,
  minimum_score integer NOT NULL DEFAULT 70 CHECK (minimum_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_employees IS NULL OR max_employees IS NULL OR min_employees <= max_employees),
  CHECK (min_locations IS NULL OR max_locations IS NULL OR min_locations <= max_locations)
);

CREATE TABLE IF NOT EXISTS connect_qualification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('FIT','CONTACT','NEED','TIMING','HANDOFF','EXCLUSION')),
  rule_type text NOT NULL CHECK (rule_type IN ('REQUIRED','PREFERRED','EXCLUDE')),
  label text NOT NULL,
  description text,
  weight integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN -100 AND 100),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_qualification_rules_client_idx
  ON connect_qualification_rules(client_id, is_active, sort_order);

ALTER TABLE connect_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_icp_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_qualification_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_clients FROM anon, authenticated;
REVOKE ALL ON connect_icp_profiles FROM anon, authenticated;
REVOKE ALL ON connect_qualification_rules FROM anon, authenticated;
