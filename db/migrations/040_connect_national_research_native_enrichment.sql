-- National research coordinator + ArborLine-owned contact enrichment foundation.
-- This migration creates only data structures. It does not activate new markets,
-- enable provider spend, approve outreach, queue messages, or send email.

CREATE TABLE IF NOT EXISTS connect_research_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  market_type text NOT NULL CHECK (market_type IN ('METRO','STATE','NATIONAL')),
  country text NOT NULL DEFAULT 'US',
  state_codes text[] NOT NULL DEFAULT '{}'::text[],
  tier integer NOT NULL DEFAULT 3 CHECK (tier BETWEEN 1 AND 4),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETE')),
  geography jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_research_markets_status_idx
  ON connect_research_markets(status, tier, priority, slug);

CREATE TABLE IF NOT EXISTS connect_market_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  market_id uuid NOT NULL REFERENCES connect_research_markets(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES connect_prospect_segments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETE')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  target_prospect_count integer NOT NULL DEFAULT 100 CHECK (target_prospect_count >= 0),
  last_discovery_at timestamptz,
  last_research_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, market_id, segment_id)
);

CREATE INDEX IF NOT EXISTS connect_market_segments_queue_idx
  ON connect_market_segments(status, priority, updated_at)
  WHERE status IN ('PLANNED','ACTIVE');
CREATE INDEX IF NOT EXISTS connect_market_segments_segment_idx
  ON connect_market_segments(segment_id, status);

ALTER TABLE connect_prospects
  ADD COLUMN IF NOT EXISTS market_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connect_prospects_market_id_fkey'
      AND conrelid = 'connect_prospects'::regclass
  ) THEN
    ALTER TABLE connect_prospects
      ADD CONSTRAINT connect_prospects_market_id_fkey
      FOREIGN KEY (market_id) REFERENCES connect_research_markets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS connect_prospects_market_segment_idx
  ON connect_prospects(market_id, segment_id, qualification_status, enrichment_status);

CREATE TABLE IF NOT EXISTS connect_contact_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES connect_prospects(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES connect_prospect_segments(id) ON DELETE SET NULL,
  market_id uuid REFERENCES connect_research_markets(id) ON DELETE SET NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('PUBLIC_SITE','LEARNED_PATTERN','PROVIDER_OBSERVED','MANUAL')),
  contact_name text,
  contact_title text,
  email text,
  identity_confidence integer NOT NULL DEFAULT 0 CHECK (identity_confidence BETWEEN 0 AND 100),
  email_confidence integer NOT NULL DEFAULT 0 CHECK (email_confidence BETWEEN 0 AND 100),
  email_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (email_status IN (
    'UNKNOWN','PUBLISHED_UNVERIFIED','INFERRED_UNVERIFIED','SYNTAX_VALID','MX_VALID','VERIFIED','INVALID','CATCH_ALL','TEMPORARY'
  )),
  source_url text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_contact_candidates_prospect_email_uidx
  ON connect_contact_candidates(prospect_id, lower(email))
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS connect_contact_candidates_review_idx
  ON connect_contact_candidates(client_id, email_status, email_confidence DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS connect_contact_candidates_domain_idx
  ON connect_contact_candidates((lower(split_part(email, '@', 2))))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_domain_email_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  domain text NOT NULL,
  pattern text NOT NULL CHECK (pattern IN (
    'FIRST.LAST','FIRST_LAST','FIRST-LAST','FIRSTLAST','F_LAST','F.LAST','FIRST'
  )),
  verified_samples integer NOT NULL DEFAULT 0 CHECK (verified_samples >= 0),
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, domain, pattern)
);

CREATE INDEX IF NOT EXISTS connect_domain_email_patterns_lookup_idx
  ON connect_domain_email_patterns(client_id, lower(domain), confidence DESC, verified_samples DESC);

CREATE TABLE IF NOT EXISTS connect_email_verification_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  email text NOT NULL,
  domain text NOT NULL,
  syntax_valid boolean NOT NULL DEFAULT false,
  mx_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (mx_status IN ('UNKNOWN','VALID','MISSING','TEMPORARY_ERROR')),
  mx_hosts jsonb NOT NULL DEFAULT '[]'::jsonb,
  smtp_status text NOT NULL DEFAULT 'NOT_CHECKED' CHECK (smtp_status IN ('NOT_CHECKED','VALID','INVALID','CATCH_ALL','TEMPORARY','UNKNOWN')),
  provider_verified boolean NOT NULL DEFAULT false,
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (client_id, email)
);

CREATE INDEX IF NOT EXISTS connect_email_verification_cache_domain_idx
  ON connect_email_verification_cache(client_id, lower(domain), checked_at DESC);
CREATE INDEX IF NOT EXISTS connect_email_verification_cache_expiry_idx
  ON connect_email_verification_cache(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE connect_research_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_market_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_contact_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_domain_email_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE connect_email_verification_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON connect_research_markets FROM anon, authenticated;
REVOKE ALL ON connect_market_segments FROM anon, authenticated;
REVOKE ALL ON connect_contact_candidates FROM anon, authenticated;
REVOKE ALL ON connect_domain_email_patterns FROM anon, authenticated;
REVOKE ALL ON connect_email_verification_cache FROM anon, authenticated;
