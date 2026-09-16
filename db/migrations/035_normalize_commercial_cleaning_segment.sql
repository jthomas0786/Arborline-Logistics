-- Normalize ArborLine Connect's original Commercial Cleaning campaign into the
-- segment system introduced after the first outreach batch. Existing prospect,
-- outreach, reply, and delivery history is preserved.

WITH arborline AS (
  SELECT id
  FROM connect_clients
  WHERE lower(company_name) = 'arborline connect'
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO connect_prospect_segments (
  client_id,
  slug,
  name,
  service_vertical,
  status,
  target_industries,
  target_geographies,
  min_employees,
  max_employees,
  decision_maker_titles,
  exclusions,
  qualification_notes,
  minimum_score,
  approved_at
)
SELECT
  id,
  'commercial-cleaning',
  'Commercial Cleaning',
  'Commercial Cleaning',
  'ACTIVE',
  ARRAY[
    'Commercial Cleaning',
    'Janitorial Services',
    'Facilities Services',
    'Building Services',
    'Commercial Cleaning Services'
  ]::text[],
  ARRAY['Illinois','Indiana','Wisconsin']::text[],
  5,
  500,
  ARRAY[
    'Owner',
    'President',
    'CEO',
    'Founder',
    'General Manager',
    'Managing Partner',
    'COO',
    'Chief Operating Officer',
    'VP Sales',
    'Vice President of Sales',
    'Sales Director',
    'Sales Manager',
    'Director of Business Development',
    'Business Development Manager',
    'Director of Operations'
  ]::text[],
  ARRAY[
    'residential-only cleaning',
    'house cleaning only',
    'maid service only',
    'cleaning association',
    'cleaning equipment supplier',
    'staffing company',
    'in-house facility operator'
  ]::text[],
  'Original ArborLine Commercial Cleaning campaign normalized into the segment system. Historical outreach and qualification state are preserved.',
  70,
  now()
FROM arborline
ON CONFLICT (client_id, slug) DO UPDATE SET
  name = EXCLUDED.name,
  service_vertical = EXCLUDED.service_vertical,
  status = 'ACTIVE',
  target_industries = EXCLUDED.target_industries,
  target_geographies = EXCLUDED.target_geographies,
  min_employees = EXCLUDED.min_employees,
  max_employees = EXCLUDED.max_employees,
  decision_maker_titles = EXCLUDED.decision_maker_titles,
  exclusions = EXCLUDED.exclusions,
  qualification_notes = EXCLUDED.qualification_notes,
  minimum_score = EXCLUDED.minimum_score,
  approved_at = COALESCE(connect_prospect_segments.approved_at, now()),
  updated_at = now();

WITH cleaning AS (
  SELECT s.id AS segment_id, s.client_id
  FROM connect_prospect_segments s
  JOIN connect_clients c ON c.id = s.client_id
  WHERE lower(c.company_name) = 'arborline connect'
    AND s.slug = 'commercial-cleaning'
  ORDER BY s.created_at ASC
  LIMIT 1
)
UPDATE connect_prospects p
SET
  segment_id = cleaning.segment_id,
  source_metadata = jsonb_set(
    COALESCE(p.source_metadata, '{}'::jsonb),
    '{segment_id}',
    to_jsonb(cleaning.segment_id::text),
    true
  ),
  updated_at = now()
FROM cleaning
WHERE p.client_id = cleaning.client_id
  AND p.segment_id IS NULL
  AND p.company_name = ANY(ARRAY[
    'RamClean Commercial Cleaning & Janitorial Services',
    'Blu Commercial Cleaning',
    'Pink Team Cleaning Services LLC',
    'YORA Cleaning',
    'Renue Systems, Inc.',
    'Sparkle & Shine Janitorial Services',
    'Power Bright Cleaning Services',
    'Building Services of America (BSA)',
    'Clean Impact Commercial Cleaning',
    'Crescent Cleaning',
    'Mokena Lot Cleaners - Parking Lot Sweeping, Litter Cleanup, and Portering',
    'Bee Line',
    'Commercial Janitorial Services',
    'Building Services Group Inc',
    'Spotless Cleaning Chicago',
    'Commercial Janitorial Services, LLC',
    'Beautiful Cleaning',
    'Becht Pride',
    'Master Clean, Inc.',
    'Rembrandt Cleaning'
  ]::text[]);

-- Keep the legacy metadata representation synchronized because older campaign
-- intelligence queries still read it while newer workflows use segment_id.
UPDATE connect_prospects
SET source_metadata = jsonb_set(
      COALESCE(source_metadata, '{}'::jsonb),
      '{segment_id}',
      to_jsonb(segment_id::text),
      true
    ),
    updated_at = now()
WHERE segment_id IS NOT NULL
  AND COALESCE(source_metadata->>'segment_id', '') <> segment_id::text;
