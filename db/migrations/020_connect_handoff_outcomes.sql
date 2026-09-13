ALTER TABLE connect_handoffs
  DROP CONSTRAINT IF EXISTS connect_handoffs_status_check;

ALTER TABLE connect_handoffs
  ADD CONSTRAINT connect_handoffs_status_check
  CHECK (status IN ('READY_FOR_REVIEW','SCHEDULING','SCHEDULED','HELD','NO_SHOW','CLOSED','DECLINED'));

ALTER TABLE connect_handoffs
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_notes text;
