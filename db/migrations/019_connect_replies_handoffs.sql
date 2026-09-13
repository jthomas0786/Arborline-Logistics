CREATE TABLE IF NOT EXISTS connect_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES connect_clients(id) ON DELETE SET NULL,
  prospect_id uuid REFERENCES connect_prospects(id) ON DELETE SET NULL,
  outreach_message_id uuid REFERENCES connect_outreach_messages(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'RESEND',
  provider_email_id text NOT NULL,
  provider_message_id text,
  from_email text NOT NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  subject text,
  body_text text,
  match_status text NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('MATCHED','UNMATCHED')),
  classification_status text NOT NULL DEFAULT 'PENDING' CHECK (classification_status IN ('PENDING','CLASSIFIED','NEEDS_REVIEW')),
  classification text CHECK (classification IS NULL OR classification IN ('INTERESTED','OBJECTION','NOT_NOW','WRONG_CONTACT','UNSUBSCRIBE','OUT_OF_OFFICE','UNKNOWN')),
  classification_confidence integer CHECK (classification_confidence IS NULL OR classification_confidence BETWEEN 0 AND 100),
  classification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_email_id)
);

CREATE INDEX IF NOT EXISTS connect_replies_client_idx
  ON connect_replies(client_id, received_at DESC);
CREATE INDEX IF NOT EXISTS connect_replies_pending_idx
  ON connect_replies(classification_status, received_at)
  WHERE match_status='MATCHED' AND classification_status='PENDING';
CREATE INDEX IF NOT EXISTS connect_replies_from_idx
  ON connect_replies(lower(from_email), received_at DESC);

CREATE TABLE IF NOT EXISTS connect_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES connect_prospects(id) ON DELETE CASCADE,
  reply_id uuid NOT NULL UNIQUE REFERENCES connect_replies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'READY_FOR_REVIEW' CHECK (status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED','CLOSED','DECLINED')),
  booking_type text NOT NULL DEFAULT 'CALL' CHECK (booking_type IN ('CALL','ESTIMATE','DEMO','WALKTHROUGH','OTHER')),
  contact_name text,
  contact_email text,
  company_name text,
  summary text NOT NULL,
  suggested_next_step text,
  scheduled_for timestamptz,
  meeting_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_handoffs_client_status_idx
  ON connect_handoffs(client_id, status, created_at DESC);

ALTER TABLE connect_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_handoffs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_replies FROM anon, authenticated;
REVOKE ALL ON connect_handoffs FROM anon, authenticated;
