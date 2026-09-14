ALTER TABLE public.connect_pilot_interest
  ADD COLUMN IF NOT EXISTS sample_provider text,
  ADD COLUMN IF NOT EXISTS sample_search_criteria jsonb,
  ADD COLUMN IF NOT EXISTS sample_generation_error text,
  ADD COLUMN IF NOT EXISTS sample_generated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.connect_free_sample_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.connect_pilot_interest(id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 20),
  company_name text NOT NULL,
  website text,
  domain text,
  industry text,
  city text,
  state text,
  country text,
  employee_count integer,
  source text NOT NULL DEFAULT 'UNKNOWN',
  source_url text,
  match_score integer NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  match_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, rank)
);

CREATE INDEX IF NOT EXISTS connect_free_sample_matches_request_idx
  ON public.connect_free_sample_matches(request_id, selected, rank);

ALTER TABLE public.connect_free_sample_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connect_free_sample_matches FROM anon, authenticated;
