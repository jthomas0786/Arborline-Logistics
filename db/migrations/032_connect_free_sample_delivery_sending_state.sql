ALTER TABLE public.connect_pilot_interest
  DROP CONSTRAINT IF EXISTS connect_pilot_interest_sample_email_status_check;

ALTER TABLE public.connect_pilot_interest
  ADD CONSTRAINT connect_pilot_interest_sample_email_status_check
  CHECK (sample_email_status IN ('NOT_DRAFTED','DRAFT','APPROVED','SENDING','SENT','FAILED'));
