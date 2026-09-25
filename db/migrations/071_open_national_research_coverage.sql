-- Open ArborLine Connect's remaining U.S. research coverage for native/public
-- discovery and enrichment. This changes research coverage only. It does not
-- enable paid provider spend, approve outreach, queue messages, or send email.

WITH arborline_client AS (
  SELECT id
  FROM connect_clients
  WHERE lower(company_name)=lower('ArborLine Connect')
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE connect_research_markets m
SET status='ACTIVE',
    metadata=coalesce(m.metadata,'{}'::jsonb) || jsonb_build_object(
      'rollout','NATIONAL_RESEARCH_OPEN_V1',
      'rollout_activated_at',now(),
      'native_public_only',true,
      'provider_spend_enabled',false
    ),
    updated_at=now()
WHERE m.country='US'
  AND m.status='PLANNED'
  AND EXISTS (SELECT 1 FROM arborline_client);

-- Keep ArborLine's approved/active service segments geographically aligned
-- with the nationwide market catalog so native discovery/scoring can accept
-- candidates from every U.S. state and the District of Columbia.
WITH arborline_client AS (
  SELECT id
  FROM connect_clients
  WHERE lower(company_name)=lower('ArborLine Connect')
  ORDER BY created_at ASC
  LIMIT 1
), us_geographies(name) AS (
  VALUES
    ('Alabama'),('Alaska'),('Arizona'),('Arkansas'),('California'),
    ('Colorado'),('Connecticut'),('Delaware'),('Florida'),('Georgia'),
    ('Hawaii'),('Idaho'),('Illinois'),('Indiana'),('Iowa'),
    ('Kansas'),('Kentucky'),('Louisiana'),('Maine'),('Maryland'),
    ('Massachusetts'),('Michigan'),('Minnesota'),('Mississippi'),('Missouri'),
    ('Montana'),('Nebraska'),('Nevada'),('New Hampshire'),('New Jersey'),
    ('New Mexico'),('New York'),('North Carolina'),('North Dakota'),('Ohio'),
    ('Oklahoma'),('Oregon'),('Pennsylvania'),('Rhode Island'),('South Carolina'),
    ('South Dakota'),('Tennessee'),('Texas'),('Utah'),('Vermont'),
    ('Virginia'),('Washington'),('West Virginia'),('Wisconsin'),('Wyoming'),
    ('District of Columbia')
)
UPDATE connect_prospect_segments s
SET target_geographies = ARRAY(
      SELECT DISTINCT geography
      FROM unnest(
        coalesce(s.target_geographies,'{}'::text[]) ||
        ARRAY(SELECT name FROM us_geographies)
      ) AS geography
      ORDER BY geography
    ),
    updated_at=now()
FROM arborline_client c
WHERE s.client_id=c.id
  AND s.status IN ('APPROVED','ACTIVE');

-- Activate only ArborLine Connect's market/segment cells. Other clients retain
-- their own rollout state even though the shared U.S. market catalog is active.
WITH arborline_client AS (
  SELECT id
  FROM connect_clients
  WHERE lower(company_name)=lower('ArborLine Connect')
  ORDER BY created_at ASC
  LIMIT 1
)
UPDATE connect_market_segments ms
SET status='ACTIVE',
    target_prospect_count=GREATEST(ms.target_prospect_count,100),
    metadata=coalesce(ms.metadata,'{}'::jsonb) || jsonb_build_object(
      'rollout','NATIONAL_RESEARCH_OPEN_V1',
      'rollout_activated_at',now(),
      'native_public_only',true,
      'provider_spend_enabled',false
    ),
    updated_at=now()
FROM arborline_client c,
     connect_research_markets m,
     connect_prospect_segments s
WHERE ms.client_id=c.id
  AND ms.market_id=m.id
  AND ms.segment_id=s.id
  AND m.country='US'
  AND m.status='ACTIVE'
  AND s.client_id=c.id
  AND s.status IN ('APPROVED','ACTIVE')
  AND ms.status='PLANNED';
