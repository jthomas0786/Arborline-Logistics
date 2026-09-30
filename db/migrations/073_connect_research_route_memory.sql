CREATE TABLE IF NOT EXISTS public.connect_research_route_memory (
  domain text NOT NULL,
  path text NOT NULL,
  last_status integer,
  consecutive_hard_misses integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, path),
  CONSTRAINT connect_research_route_memory_path_check CHECK (path LIKE '/%'),
  CONSTRAINT connect_research_route_memory_status_check CHECK (last_status IS NULL OR last_status BETWEEN 100 AND 599),
  CONSTRAINT connect_research_route_memory_hard_misses_check CHECK (consecutive_hard_misses >= 0),
  CONSTRAINT connect_research_route_memory_success_count_check CHECK (success_count >= 0)
);

ALTER TABLE public.connect_research_route_memory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.connect_research_route_memory FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connect_research_route_memory TO service_role;

CREATE INDEX IF NOT EXISTS connect_research_route_memory_dead_idx
  ON public.connect_research_route_memory (domain, last_checked_at DESC)
  WHERE last_status IN (404, 410) AND consecutive_hard_misses > 0;

CREATE INDEX IF NOT EXISTS connect_research_route_memory_success_idx
  ON public.connect_research_route_memory (domain, last_success_at DESC)
  WHERE last_success_at IS NOT NULL;
