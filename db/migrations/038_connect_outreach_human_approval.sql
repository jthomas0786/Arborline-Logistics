ALTER TABLE connect_outreach_messages
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approval_source text;

ALTER TABLE connect_outreach_messages
  DROP CONSTRAINT IF EXISTS connect_outreach_messages_approval_source_check;

ALTER TABLE connect_outreach_messages
  ADD CONSTRAINT connect_outreach_messages_approval_source_check
  CHECK (
    approval_source IS NULL
    OR approval_source IN ('STAFF_SINGLE','STAFF_BATCH','LEGACY_USER_CONFIRMED')
  );

CREATE OR REPLACE FUNCTION enforce_connect_outreach_human_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'QUEUED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'QUEUED') THEN
    IF NEW.approved_at IS NULL
       OR NEW.approved_by_user_id IS NULL
       OR NEW.approval_source IS NULL THEN
      RAISE EXCEPTION 'Queued Connect outreach requires explicit human approval evidence.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connect_outreach_human_approval_guard
  ON connect_outreach_messages;

CREATE TRIGGER connect_outreach_human_approval_guard
BEFORE INSERT OR UPDATE OF status
ON connect_outreach_messages
FOR EACH ROW
EXECUTE FUNCTION enforce_connect_outreach_human_approval();

CREATE INDEX IF NOT EXISTS connect_outreach_messages_approval_idx
  ON connect_outreach_messages(status, approved_at)
  WHERE status = 'QUEUED';
