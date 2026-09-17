ALTER TABLE connect_outreach_messages
  DROP CONSTRAINT IF EXISTS connect_outreach_messages_approval_source_check;

ALTER TABLE connect_outreach_messages
  ADD CONSTRAINT connect_outreach_messages_approval_source_check
  CHECK (
    approval_source IS NULL
    OR approval_source IN ('STAFF_SINGLE','STAFF_BATCH','STAFF_BATCH_CONFIRMED','LEGACY_USER_CONFIRMED')
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

    IF NEW.approval_source = 'STAFF_BATCH' THEN
      RAISE EXCEPTION 'Legacy batch outreach approval is disabled; use confirmed batch approval.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
