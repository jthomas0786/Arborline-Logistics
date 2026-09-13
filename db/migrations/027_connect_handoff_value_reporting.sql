ALTER TABLE connect_handoffs
  ADD COLUMN IF NOT EXISTS estimated_monthly_value numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connect_handoffs_estimated_monthly_value_check'
  ) THEN
    ALTER TABLE connect_handoffs
      ADD CONSTRAINT connect_handoffs_estimated_monthly_value_check
      CHECK (estimated_monthly_value IS NULL OR estimated_monthly_value >= 0);
  END IF;
END $$;
