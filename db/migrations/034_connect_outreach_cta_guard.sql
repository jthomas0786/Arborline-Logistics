DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connect_outreach_no_stale_cta_when_queued'
  ) THEN
    ALTER TABLE connect_outreach_messages
      ADD CONSTRAINT connect_outreach_no_stale_cta_when_queued
      CHECK (
        status <> 'QUEUED'
        OR body_text !~* '(15[[:space:]-]?minute|15[[:space:]]*min|2[[:space:]-]?minute[[:space:]]+walkthrough)'
      );
  END IF;
END $$;
