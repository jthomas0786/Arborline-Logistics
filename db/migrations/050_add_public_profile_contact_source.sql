ALTER TABLE public.connect_contact_candidates
  DROP CONSTRAINT IF EXISTS connect_contact_candidates_source_kind_check;

ALTER TABLE public.connect_contact_candidates
  ADD CONSTRAINT connect_contact_candidates_source_kind_check
  CHECK (source_kind = ANY (ARRAY[
    'PUBLIC_SITE'::text,
    'PUBLIC_PROFILE'::text,
    'LEARNED_PATTERN'::text,
    'PROVIDER_OBSERVED'::text,
    'MANUAL'::text
  ]));

COMMENT ON COLUMN public.connect_contact_candidates.source_kind IS
  'Evidence source for the candidate. PUBLIC_PROFILE means an email or identity was exposed on a publicly accessible business/social profile without login or access-control bypass.';
