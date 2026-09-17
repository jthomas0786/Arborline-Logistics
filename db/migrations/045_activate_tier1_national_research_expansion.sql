-- Expand ArborLine's native/public national research pilot into seven additional
-- Tier-1 metros. This migration changes research coverage only. It does not
-- enable paid provider spend, approve outreach, queue messages, or send email.

WITH target_markets(slug) AS (
  VALUES
    ('dallas-fort-worth'),
    ('houston'),
    ('atlanta'),
    ('phoenix'),
    ('washington-dc'),
    ('philadelphia'),
    ('charlotte')
)
UPDATE connect_research_markets m
SET status='ACTIVE',
    metadata=coalesce(m.metadata,'{}'::jsonb) || jsonb_build_object(
      'rollout','TIER1_EXPANSION_V1',
      'rollout_activated_at',now(),
      'provider_spend_enabled',false
    ),
    updated_at=now()
FROM target_markets t
WHERE m.slug=t.slug
  AND m.market_type='METRO'
  AND m.tier=1;

-- Keep the active service-industry segments geographically aligned with the
-- newly activated metros so public discovery/scoring accepts those candidates.
UPDATE connect_prospect_segments s
SET target_geographies = ARRAY(
      SELECT DISTINCT geography
      FROM unnest(
        coalesce(s.target_geographies,'{}'::text[]) || ARRAY[
          'Texas','Georgia','Arizona','District of Columbia','Virginia','Maryland',
          'Pennsylvania','New Jersey','Delaware','North Carolina','South Carolina'
        ]::text[]
      ) AS geography
      ORDER BY geography
    ),
    updated_at=now()
WHERE s.status='ACTIVE';

WITH target_markets(slug) AS (
  VALUES
    ('dallas-fort-worth'),
    ('houston'),
    ('atlanta'),
    ('phoenix'),
    ('washington-dc'),
    ('philadelphia'),
    ('charlotte')
)
UPDATE connect_market_segments ms
SET status='ACTIVE',
    priority=LEAST(ms.priority,25),
    target_prospect_count=GREATEST(ms.target_prospect_count,100),
    metadata=coalesce(ms.metadata,'{}'::jsonb) || jsonb_build_object(
      'rollout','TIER1_EXPANSION_V1',
      'rollout_activated_at',now(),
      'native_public_only',true
    ),
    updated_at=now()
FROM connect_research_markets m,
     connect_prospect_segments s,
     target_markets t
WHERE ms.market_id=m.id
  AND ms.segment_id=s.id
  AND m.slug=t.slug
  AND m.status='ACTIVE'
  AND s.status='ACTIVE'
  AND ms.client_id=s.client_id;
