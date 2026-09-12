CREATE TABLE IF NOT EXISTS connect_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  website text,
  domain text,
  industry text,
  city text,
  state text,
  country text NOT NULL DEFAULT 'US',
  employee_count integer CHECK (employee_count IS NULL OR employee_count >= 0),
  location_count integer CHECK (location_count IS NULL OR location_count >= 0),
  facility_type text,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  source text,
  source_url text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  buying_signals text[] NOT NULL DEFAULT '{}',
  enrichment_status text NOT NULL DEFAULT 'PENDING' CHECK (enrichment_status IN ('PENDING','ENRICHED','PARTIAL','FAILED')),
  qualification_status text NOT NULL DEFAULT 'PENDING' CHECK (qualification_status IN ('PENDING','QUALIFIED','REVIEW','REJECTED','SUPPRESSED')),
  qualification_score integer CHECK (qualification_score IS NULL OR qualification_score BETWEEN 0 AND 100),
  qualification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  outreach_status text NOT NULL DEFAULT 'NOT_READY' CHECK (outreach_status IN ('NOT_READY','READY','QUEUED','CONTACTED','REPLIED','BOOKED','STOPPED')),
  suppression_status text NOT NULL DEFAULT 'CLEAR' CHECK (suppression_status IN ('CLEAR','DO_NOT_CONTACT','UNSUBSCRIBED','BOUNCED','COMPLAINT')),
  last_scored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, domain, contact_email)
);

CREATE INDEX IF NOT EXISTS connect_prospects_client_status_idx
  ON connect_prospects(client_id, qualification_status, outreach_status, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_prospects_contact_email_idx
  ON connect_prospects(lower(contact_email)) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS connect_prospects_domain_idx
  ON connect_prospects(lower(domain)) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES connect_clients(id) ON DELETE CASCADE,
  email text,
  domain text,
  reason text NOT NULL CHECK (reason IN ('DO_NOT_CONTACT','UNSUBSCRIBED','BOUNCED','COMPLAINT','MANUAL')),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR domain IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_suppressions_client_email_uq
  ON connect_suppressions(COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email))
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS connect_suppressions_client_domain_uq
  ON connect_suppressions(COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(domain))
  WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES connect_prospects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
  sender_name text NOT NULL DEFAULT 'Josh Thomas',
  sender_email text,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  provider text NOT NULL DEFAULT 'RESEND',
  provider_message_id text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','QUEUED','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED','CANCELLED')),
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_outreach_messages_prospect_idx
  ON connect_outreach_messages(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS connect_outreach_messages_status_idx
  ON connect_outreach_messages(status, created_at);

ALTER TABLE connect_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_outreach_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_prospects FROM anon, authenticated;
REVOKE ALL ON connect_suppressions FROM anon, authenticated;
REVOKE ALL ON connect_outreach_messages FROM anon, authenticated;
