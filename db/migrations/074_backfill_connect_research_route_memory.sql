WITH recent AS (
  SELECT
    lower(domain) AS domain,
    source_metadata#>'{public_research,pages_checked}' AS pages,
    source_metadata#>'{public_research,diagnostics,pageDiscovery,fetchFailureSamples}' AS failures,
    NULLIF(source_metadata->>'public_research_checked_at','')::timestamptz AS checked_at
  FROM public.connect_prospects
  WHERE domain IS NOT NULL
    AND source_metadata ? 'public_research_checked_at'
),
success_observations AS (
  SELECT
    r.domain,
    page #>> '{}' AS url,
    200 AS status,
    r.checked_at
  FROM recent r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.pages,'[]'::jsonb)) page
  WHERE r.checked_at >= now() - interval '180 days'
),
hard_miss_observations AS (
  SELECT
    r.domain,
    sample->>'url' AS url,
    (sample->>'status')::integer AS status,
    r.checked_at
  FROM recent r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.failures,'[]'::jsonb)) sample
  WHERE r.checked_at >= now() - interval '30 days'
    AND (sample->>'status') ~ '^\d+$'
    AND (sample->>'status')::integer IN (404,410)
),
observations AS (
  SELECT * FROM success_observations
  UNION ALL
  SELECT * FROM hard_miss_observations
),
normalized AS (
  SELECT
    domain,
    CASE
      WHEN raw_path = '' OR raw_path = '/' THEN '/'
      ELSE regexp_replace(raw_path, '/+$', '')
    END AS path,
    status,
    checked_at
  FROM (
    SELECT
      domain,
      regexp_replace(
        regexp_replace(url, '^https?://[^/]+', '', 'i'),
        '[?#].*$',
        ''
      ) AS raw_path,
      status,
      checked_at,
      lower(regexp_replace(split_part(split_part(url,'://',2),'/',1),'^www\.','','i')) AS observed_host
    FROM observations
    WHERE url IS NOT NULL AND url ~* '^https?://'
  ) x
  WHERE observed_host = domain
),
latest AS (
  SELECT DISTINCT ON (domain,path)
    domain,path,status,checked_at
  FROM normalized
  WHERE path LIKE '/%'
  ORDER BY domain,path,checked_at DESC,(status=200) DESC
),
stats AS (
  SELECT
    domain,
    path,
    count(*) FILTER (WHERE status=200)::integer AS success_count,
    max(checked_at) FILTER (WHERE status=200) AS last_success_at
  FROM normalized
  WHERE path LIKE '/%'
  GROUP BY domain,path
)
INSERT INTO public.connect_research_route_memory
  (domain,path,last_status,consecutive_hard_misses,success_count,last_checked_at,last_success_at,updated_at)
SELECT
  l.domain,
  l.path,
  l.status,
  CASE WHEN l.status IN (404,410) THEN 1 ELSE 0 END,
  s.success_count,
  l.checked_at,
  s.last_success_at,
  now()
FROM latest l
JOIN stats s USING (domain,path)
ON CONFLICT (domain,path) DO UPDATE
SET last_status = CASE
      WHEN EXCLUDED.last_checked_at >= public.connect_research_route_memory.last_checked_at THEN EXCLUDED.last_status
      ELSE public.connect_research_route_memory.last_status
    END,
    consecutive_hard_misses = CASE
      WHEN EXCLUDED.last_checked_at >= public.connect_research_route_memory.last_checked_at
        THEN EXCLUDED.consecutive_hard_misses
      ELSE public.connect_research_route_memory.consecutive_hard_misses
    END,
    success_count = GREATEST(public.connect_research_route_memory.success_count,EXCLUDED.success_count),
    last_checked_at = GREATEST(public.connect_research_route_memory.last_checked_at,EXCLUDED.last_checked_at),
    last_success_at = GREATEST(public.connect_research_route_memory.last_success_at,EXCLUDED.last_success_at),
    updated_at = now();
