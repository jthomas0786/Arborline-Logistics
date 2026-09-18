CREATE TABLE IF NOT EXISTS public.connect_prepared_outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL UNIQUE REFERENCES public.connect_prospects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body_text text NOT NULL,
  experiment_key text,
  experiment_variant text,
  contact_name_snapshot text,
  contact_title_snapshot text,
  qualification_score_snapshot integer,
  status text NOT NULL DEFAULT 'PREPARED',
  prepared_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_prepared_outreach_drafts_status_check
    CHECK (status IN ('PREPARED','PROMOTED','CANCELLED')),
  CONSTRAINT connect_prepared_outreach_drafts_experiment_variant_check
    CHECK (experiment_variant IS NULL OR experiment_variant IN ('CONTROL','SAMPLES_LINK'))
);

CREATE INDEX IF NOT EXISTS connect_prepared_outreach_drafts_client_status_idx
  ON public.connect_prepared_outreach_drafts(client_id,status,prepared_at DESC);

CREATE INDEX IF NOT EXISTS connect_prepared_outreach_drafts_status_idx
  ON public.connect_prepared_outreach_drafts(status,prepared_at DESC);

ALTER TABLE public.connect_prepared_outreach_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connect_prepared_outreach_drafts FROM anon, authenticated;

COMMENT ON TABLE public.connect_prepared_outreach_drafts IS
  'Review-only outreach copy prepared before mailbox verification. Rows are not sendable and must be promoted into connect_outreach_messages only after the prospect passes the centralized verified-contact gate.';
