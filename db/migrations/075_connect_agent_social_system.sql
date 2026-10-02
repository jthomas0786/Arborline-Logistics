CREATE TABLE IF NOT EXISTS public.connect_agent_settings (
  client_id uuid PRIMARY KEY REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  content_agent_enabled boolean NOT NULL DEFAULT true,
  market_watch_enabled boolean NOT NULL DEFAULT true,
  research_agent_enabled boolean NOT NULL DEFAULT true,
  enrichment_agent_enabled boolean NOT NULL DEFAULT true,
  outreach_agent_enabled boolean NOT NULL DEFAULT true,
  reply_agent_enabled boolean NOT NULL DEFAULT true,
  linkedin_company_publish_mode text NOT NULL DEFAULT 'APPROVAL',
  linkedin_personal_publish_mode text NOT NULL DEFAULT 'APPROVAL',
  linkedin_outreach_mode text NOT NULL DEFAULT 'APPROVAL',
  email_outreach_mode text NOT NULL DEFAULT 'APPROVAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_agent_settings_company_mode_check CHECK (linkedin_company_publish_mode IN ('OFF','APPROVAL','AUTO')),
  CONSTRAINT connect_agent_settings_personal_mode_check CHECK (linkedin_personal_publish_mode IN ('OFF','APPROVAL','AUTO')),
  CONSTRAINT connect_agent_settings_linkedin_outreach_mode_check CHECK (linkedin_outreach_mode IN ('OFF','APPROVAL')),
  CONSTRAINT connect_agent_settings_email_outreach_mode_check CHECK (email_outreach_mode IN ('OFF','APPROVAL','AUTO'))
);

CREATE TABLE IF NOT EXISTS public.connect_social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'LINKEDIN',
  author_type text NOT NULL,
  content_key text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  topic text NOT NULL,
  body_text text NOT NULL,
  source_signal text,
  image_prompt text,
  scheduled_for timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_social_posts_platform_check CHECK (platform IN ('LINKEDIN')),
  CONSTRAINT connect_social_posts_author_type_check CHECK (author_type IN ('COMPANY','PERSONAL')),
  CONSTRAINT connect_social_posts_status_check CHECK (status IN ('DRAFT','APPROVED','SCHEDULED','PUBLISHED','FAILED','CANCELLED')),
  CONSTRAINT connect_social_posts_client_content_key_unique UNIQUE (client_id, content_key)
);

CREATE TABLE IF NOT EXISTS public.connect_social_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'LINKEDIN',
  signal_key text NOT NULL,
  signal_type text NOT NULL,
  actor_name text,
  actor_title text,
  company_name text,
  source_url text,
  excerpt text,
  fit_score integer,
  status text NOT NULL DEFAULT 'NEW',
  prospect_id uuid REFERENCES public.connect_prospects(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_social_signals_platform_check CHECK (platform IN ('LINKEDIN','WEB')),
  CONSTRAINT connect_social_signals_fit_score_check CHECK (fit_score IS NULL OR fit_score BETWEEN 0 AND 100),
  CONSTRAINT connect_social_signals_status_check CHECK (status IN ('NEW','RESEARCHED','QUEUED','DISMISSED')),
  CONSTRAINT connect_social_signals_client_signal_key_unique UNIQUE (client_id, signal_key)
);

CREATE TABLE IF NOT EXISTS public.connect_linkedin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.connect_prospects(id) ON DELETE SET NULL,
  action_key text NOT NULL,
  action_type text NOT NULL,
  profile_url text,
  message_text text,
  rationale text,
  status text NOT NULL DEFAULT 'DRAFT',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_linkedin_actions_type_check CHECK (action_type IN ('CONNECT','MESSAGE','COMMENT','FOLLOW')),
  CONSTRAINT connect_linkedin_actions_status_check CHECK (status IN ('DRAFT','READY','DONE','SKIPPED')),
  CONSTRAINT connect_linkedin_actions_client_action_key_unique UNIQUE (client_id, action_key)
);

CREATE TABLE IF NOT EXISTS public.connect_agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.connect_clients(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'INFO',
  summary text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_agent_events_status_check CHECK (status IN ('INFO','SUCCESS','WARNING','ERROR'))
);

INSERT INTO public.connect_agent_settings (client_id)
SELECT id FROM public.connect_clients
ON CONFLICT (client_id) DO NOTHING;

ALTER TABLE public.connect_agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_social_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_linkedin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_agent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.connect_agent_settings, public.connect_social_posts, public.connect_social_signals, public.connect_linkedin_actions, public.connect_agent_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connect_agent_settings, public.connect_social_posts, public.connect_social_signals, public.connect_linkedin_actions, public.connect_agent_events TO service_role;

CREATE INDEX IF NOT EXISTS connect_social_posts_queue_idx
  ON public.connect_social_posts (client_id, status, scheduled_for, created_at DESC);

CREATE INDEX IF NOT EXISTS connect_social_signals_queue_idx
  ON public.connect_social_signals (client_id, status, fit_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS connect_linkedin_actions_queue_idx
  ON public.connect_linkedin_actions (client_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS connect_agent_events_recent_idx
  ON public.connect_agent_events (client_id, created_at DESC);
