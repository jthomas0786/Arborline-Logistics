ALTER TABLE public.connect_pilot_interest
  ADD COLUMN IF NOT EXISTS sample_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_share_token uuid,
  ADD COLUMN IF NOT EXISTS sample_email_subject text,
  ADD COLUMN IF NOT EXISTS sample_email_body text,
  ADD COLUMN IF NOT EXISTS sample_email_status text NOT NULL DEFAULT 'NOT_DRAFTED',
  ADD COLUMN IF NOT EXISTS sample_email_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_email_provider_message_id text,
  ADD COLUMN IF NOT EXISTS sample_email_error text,
  ADD COLUMN IF NOT EXISTS sample_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_conversion_status text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS sample_conversion_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='connect_pilot_interest_sample_email_status_check'
      AND conrelid='public.connect_pilot_interest'::regclass
  ) THEN
    ALTER TABLE public.connect_pilot_interest
      ADD CONSTRAINT connect_pilot_interest_sample_email_status_check
      CHECK (sample_email_status IN ('NOT_DRAFTED','DRAFT','APPROVED','SENT','FAILED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='connect_pilot_interest_sample_conversion_status_check'
      AND conrelid='public.connect_pilot_interest'::regclass
  ) THEN
    ALTER TABLE public.connect_pilot_interest
      ADD CONSTRAINT connect_pilot_interest_sample_conversion_status_check
      CHECK (sample_conversion_status IN ('OPEN','INTERESTED','NOT_NOW','CONVERTED','CLOSED'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS connect_pilot_interest_sample_share_token_idx
  ON public.connect_pilot_interest(sample_share_token)
  WHERE sample_share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS connect_pilot_interest_sample_delivery_idx
  ON public.connect_pilot_interest(request_type, sample_email_status, sample_conversion_status, created_at DESC);

ALTER TABLE public.connect_pilot_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connect_pilot_interest FROM anon, authenticated;
