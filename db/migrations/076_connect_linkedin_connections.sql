CREATE TABLE IF NOT EXISTS public.connect_linkedin_connections (
  client_id uuid PRIMARY KEY REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  encrypted_access_token text NOT NULL,
  token_iv text NOT NULL,
  token_tag text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  member_urn text,
  organization_urn text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  last_error text,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_linkedin_connections_status_check CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','ERROR'))
);

ALTER TABLE public.connect_linkedin_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connect_linkedin_connections FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connect_linkedin_connections TO service_role;

CREATE INDEX IF NOT EXISTS connect_linkedin_connections_status_idx
  ON public.connect_linkedin_connections (status, expires_at);
