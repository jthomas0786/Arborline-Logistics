-- Route positive outreach replies into the existing Free Sample review funnel.
ALTER TABLE connect_pilot_interest
  ADD COLUMN IF NOT EXISTS reply_id uuid REFERENCES connect_replies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES connect_prospects(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connect_pilot_interest_reply_sample_unique
  ON connect_pilot_interest(reply_id)
  WHERE reply_id IS NOT NULL AND request_type='FREE_SAMPLE';

DROP CONSTRAINT IF EXISTS connect_replies_classification_check;
ALTER TABLE connect_replies
  ADD CONSTRAINT connect_replies_classification_check
  CHECK (
    classification IS NULL OR classification = ANY (ARRAY[
      'INTERESTED'::text,
      'SAMPLE_REQUESTED'::text,
      'VIDEO_REQUESTED'::text,
      'OBJECTION'::text,
      'NOT_NOW'::text,
      'WRONG_CONTACT'::text,
      'UNSUBSCRIBE'::text,
      'OUT_OF_OFFICE'::text,
      'UNKNOWN'::text
    ])
  );