ALTER TABLE public.connect_contact_candidates
  ADD COLUMN IF NOT EXISTS mailbox_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mailbox_last_status text,
  ADD COLUMN IF NOT EXISTS mailbox_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS mailbox_retry_exhausted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connect_contact_candidates_mailbox_retry_count_nonnegative'
      AND conrelid = 'public.connect_contact_candidates'::regclass
  ) THEN
    ALTER TABLE public.connect_contact_candidates
      ADD CONSTRAINT connect_contact_candidates_mailbox_retry_count_nonnegative
      CHECK (mailbox_retry_count >= 0);
  END IF;
END $$;

WITH attempt_summary AS (
  SELECT
    candidate_id,
    count(*) FILTER (WHERE status IN ('TEMPORARY','UNKNOWN','NETWORK_BLOCKED'))::integer AS retry_count,
    (array_agg(status ORDER BY completed_at DESC))[1] AS last_status,
    max(completed_at) FILTER (WHERE status IN ('TEMPORARY','UNKNOWN','NETWORK_BLOCKED')) AS last_inconclusive_at
  FROM public.connect_mailbox_verification_attempts
  WHERE candidate_id IS NOT NULL
  GROUP BY candidate_id
)
UPDATE public.connect_contact_candidates c
SET mailbox_retry_count = s.retry_count,
    mailbox_last_status = s.last_status,
    mailbox_retry_exhausted_at = CASE
      WHEN c.email_status = 'UNKNOWN' AND s.retry_count >= 5 THEN s.last_inconclusive_at
      WHEN c.email_status = 'TEMPORARY' AND s.last_status = 'NETWORK_BLOCKED' AND s.retry_count >= 5 THEN s.last_inconclusive_at
      WHEN c.email_status = 'TEMPORARY' AND s.retry_count >= 6 THEN s.last_inconclusive_at
      ELSE NULL
    END,
    mailbox_next_retry_at = CASE
      WHEN c.email_status = 'UNKNOWN' AND s.retry_count >= 5 THEN NULL
      WHEN c.email_status = 'TEMPORARY' AND s.last_status = 'NETWORK_BLOCKED' AND s.retry_count >= 5 THEN NULL
      WHEN c.email_status = 'TEMPORARY' AND s.retry_count >= 6 THEN NULL
      WHEN s.last_inconclusive_at IS NULL THEN NULL
      WHEN c.email_status = 'UNKNOWN' THEN s.last_inconclusive_at + CASE
        WHEN s.retry_count <= 1 THEN interval '24 hours'
        WHEN s.retry_count = 2 THEN interval '48 hours'
        WHEN s.retry_count = 3 THEN interval '96 hours'
        ELSE interval '168 hours'
      END
      WHEN c.email_status = 'TEMPORARY' AND s.last_status = 'NETWORK_BLOCKED' THEN s.last_inconclusive_at + CASE
        WHEN s.retry_count <= 1 THEN interval '6 hours'
        WHEN s.retry_count = 2 THEN interval '12 hours'
        WHEN s.retry_count = 3 THEN interval '24 hours'
        ELSE interval '48 hours'
      END
      WHEN c.email_status = 'TEMPORARY' THEN s.last_inconclusive_at + CASE
        WHEN s.retry_count <= 1 THEN interval '2 hours'
        WHEN s.retry_count = 2 THEN interval '4 hours'
        WHEN s.retry_count = 3 THEN interval '8 hours'
        WHEN s.retry_count = 4 THEN interval '16 hours'
        ELSE interval '32 hours'
      END
      ELSE NULL
    END
FROM attempt_summary s
WHERE c.id = s.candidate_id
  AND c.email_status IN ('TEMPORARY','UNKNOWN');

CREATE INDEX IF NOT EXISTS connect_contact_candidates_mailbox_retry_due_idx
  ON public.connect_contact_candidates (email_status, mailbox_next_retry_at)
  WHERE email_status IN ('TEMPORARY','UNKNOWN') AND mailbox_retry_exhausted_at IS NULL;
