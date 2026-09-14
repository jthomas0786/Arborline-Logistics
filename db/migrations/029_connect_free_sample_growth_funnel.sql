ALTER TABLE public.connect_pilot_interest
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'FOUNDING_CLIENT',
  ADD COLUMN IF NOT EXISTS target_customer text,
  ADD COLUMN IF NOT EXISTS decision_maker_titles text,
  ADD COLUMN IF NOT EXISTS sample_status text NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS sample_prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS sample_delivered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connect_pilot_interest_request_type_check'
      AND conrelid = 'public.connect_pilot_interest'::regclass
  ) THEN
    ALTER TABLE public.connect_pilot_interest
      ADD CONSTRAINT connect_pilot_interest_request_type_check
      CHECK (request_type IN ('FOUNDING_CLIENT','FREE_SAMPLE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connect_pilot_interest_sample_status_check'
      AND conrelid = 'public.connect_pilot_interest'::regclass
  ) THEN
    ALTER TABLE public.connect_pilot_interest
      ADD CONSTRAINT connect_pilot_interest_sample_status_check
      CHECK (sample_status IN ('NOT_REQUESTED','REQUESTED','IN_PROGRESS','READY','DELIVERED','DECLINED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS connect_pilot_interest_request_type_idx
  ON public.connect_pilot_interest(request_type, sample_status, created_at DESC);

ALTER TABLE public.connect_pilot_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connect_pilot_interest FROM anon, authenticated;
