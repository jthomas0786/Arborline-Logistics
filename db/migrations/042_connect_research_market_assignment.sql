CREATE OR REPLACE FUNCTION public.connect_normalize_market_token(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(value,'')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.connect_infer_research_market_slug(
  p_city text,
  p_state text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  explicit_slug text;
  region_slug text;
  region_market text;
  city_token text;
  state_token text;
  state_code text;
BEGIN
  explicit_slug := public.connect_normalize_market_token(p_metadata->>'discovery_market_slug');
  IF explicit_slug <> '' THEN
    RETURN explicit_slug;
  END IF;

  region_slug := public.connect_normalize_market_token(p_metadata->>'discovery_region');
  region_market := CASE region_slug
    WHEN 'chicago-core' THEN 'chicago'
    WHEN 'chicago-suburbs' THEN 'chicago'
    WHEN 'northwest-indiana' THEN 'chicago'
    WHEN 'indianapolis' THEN 'indianapolis'
    WHEN 'milwaukee' THEN 'milwaukee'
    WHEN 'metro-east-southern' THEN 'st-louis'
    WHEN 'austin' THEN 'austin'
    WHEN 'san-antonio' THEN 'san-antonio'
    WHEN 'nashville' THEN 'nashville'
    WHEN 'baltimore' THEN 'baltimore'
    WHEN 'pittsburgh' THEN 'pittsburgh'
    WHEN 'las-vegas' THEN 'las-vegas'
    WHEN 'sacramento' THEN 'sacramento'
    WHEN 'kansas-city' THEN 'kansas-city'
    WHEN 'columbus' THEN 'columbus'
    WHEN 'cleveland' THEN 'cleveland'
    WHEN 'cincinnati' THEN 'cincinnati'
    WHEN 'jacksonville' THEN 'jacksonville'
    WHEN 'richmond' THEN 'richmond'
    WHEN 'salt-lake-city' THEN 'salt-lake-city'
    WHEN 'new-orleans' THEN 'new-orleans'
    ELSE NULL
  END;
  IF region_market IS NOT NULL THEN
    RETURN region_market;
  END IF;

  city_token := public.connect_normalize_market_token(p_city);
  IF city_token <> '' THEN
    CASE city_token
      WHEN 'new-york' THEN RETURN 'new-york-city';
      WHEN 'new-york-city' THEN RETURN 'new-york-city';
      WHEN 'los-angeles' THEN RETURN 'los-angeles';
      WHEN 'chicago' THEN RETURN 'chicago';
      WHEN 'dallas' THEN RETURN 'dallas-fort-worth';
      WHEN 'fort-worth' THEN RETURN 'dallas-fort-worth';
      WHEN 'houston' THEN RETURN 'houston';
      WHEN 'washington' THEN RETURN 'washington-dc';
      WHEN 'washington-dc' THEN RETURN 'washington-dc';
      WHEN 'miami' THEN RETURN 'miami-fort-lauderdale';
      WHEN 'fort-lauderdale' THEN RETURN 'miami-fort-lauderdale';
      WHEN 'philadelphia' THEN RETURN 'philadelphia';
      WHEN 'atlanta' THEN RETURN 'atlanta';
      WHEN 'phoenix' THEN RETURN 'phoenix';
      WHEN 'boston' THEN RETURN 'boston';
      WHEN 'san-francisco' THEN RETURN 'san-francisco-bay-area';
      WHEN 'oakland' THEN RETURN 'san-francisco-bay-area';
      WHEN 'san-jose' THEN RETURN 'san-francisco-bay-area';
      WHEN 'seattle' THEN RETURN 'seattle';
      WHEN 'denver' THEN RETURN 'denver';
      WHEN 'detroit' THEN RETURN 'detroit';
      WHEN 'minneapolis' THEN RETURN 'minneapolis-st-paul';
      WHEN 'saint-paul' THEN RETURN 'minneapolis-st-paul';
      WHEN 'st-paul' THEN RETURN 'minneapolis-st-paul';
      WHEN 'tampa' THEN RETURN 'tampa-bay';
      WHEN 'st-petersburg' THEN RETURN 'tampa-bay';
      WHEN 'saint-petersburg' THEN RETURN 'tampa-bay';
      WHEN 'san-diego' THEN RETURN 'san-diego';
      WHEN 'orlando' THEN RETURN 'orlando';
      WHEN 'charlotte' THEN RETURN 'charlotte';
      WHEN 'austin' THEN RETURN 'austin';
      WHEN 'san-antonio' THEN RETURN 'san-antonio';
      WHEN 'nashville' THEN RETURN 'nashville';
      WHEN 'raleigh' THEN RETURN 'raleigh-durham';
      WHEN 'durham' THEN RETURN 'raleigh-durham';
      WHEN 'st-louis' THEN RETURN 'st-louis';
      WHEN 'saint-louis' THEN RETURN 'st-louis';
      WHEN 'baltimore' THEN RETURN 'baltimore';
      WHEN 'pittsburgh' THEN RETURN 'pittsburgh';
      WHEN 'portland' THEN RETURN 'portland';
      WHEN 'las-vegas' THEN RETURN 'las-vegas';
      WHEN 'sacramento' THEN RETURN 'sacramento';
      WHEN 'kansas-city' THEN RETURN 'kansas-city';
      WHEN 'columbus' THEN RETURN 'columbus';
      WHEN 'indianapolis' THEN RETURN 'indianapolis';
      WHEN 'cleveland' THEN RETURN 'cleveland';
      WHEN 'cincinnati' THEN RETURN 'cincinnati';
      WHEN 'milwaukee' THEN RETURN 'milwaukee';
      WHEN 'jacksonville' THEN RETURN 'jacksonville';
      WHEN 'richmond' THEN RETURN 'richmond';
      WHEN 'salt-lake-city' THEN RETURN 'salt-lake-city';
      WHEN 'new-orleans' THEN RETURN 'new-orleans';
      ELSE NULL;
    END CASE;
  END IF;

  state_token := public.connect_normalize_market_token(p_state);
  state_code := CASE
    WHEN length(trim(coalesce(p_state,''))) = 2 THEN upper(trim(p_state))
    ELSE CASE state_token
      WHEN 'alabama' THEN 'AL' WHEN 'alaska' THEN 'AK' WHEN 'arizona' THEN 'AZ' WHEN 'arkansas' THEN 'AR'
      WHEN 'california' THEN 'CA' WHEN 'colorado' THEN 'CO' WHEN 'connecticut' THEN 'CT' WHEN 'delaware' THEN 'DE'
      WHEN 'florida' THEN 'FL' WHEN 'georgia' THEN 'GA' WHEN 'hawaii' THEN 'HI' WHEN 'idaho' THEN 'ID'
      WHEN 'illinois' THEN 'IL' WHEN 'indiana' THEN 'IN' WHEN 'iowa' THEN 'IA' WHEN 'kansas' THEN 'KS'
      WHEN 'kentucky' THEN 'KY' WHEN 'louisiana' THEN 'LA' WHEN 'maine' THEN 'ME' WHEN 'maryland' THEN 'MD'
      WHEN 'massachusetts' THEN 'MA' WHEN 'michigan' THEN 'MI' WHEN 'minnesota' THEN 'MN' WHEN 'mississippi' THEN 'MS'
      WHEN 'missouri' THEN 'MO' WHEN 'montana' THEN 'MT' WHEN 'nebraska' THEN 'NE' WHEN 'nevada' THEN 'NV'
      WHEN 'new-hampshire' THEN 'NH' WHEN 'new-jersey' THEN 'NJ' WHEN 'new-mexico' THEN 'NM' WHEN 'new-york' THEN 'NY'
      WHEN 'north-carolina' THEN 'NC' WHEN 'north-dakota' THEN 'ND' WHEN 'ohio' THEN 'OH' WHEN 'oklahoma' THEN 'OK'
      WHEN 'oregon' THEN 'OR' WHEN 'pennsylvania' THEN 'PA' WHEN 'rhode-island' THEN 'RI' WHEN 'south-carolina' THEN 'SC'
      WHEN 'south-dakota' THEN 'SD' WHEN 'tennessee' THEN 'TN' WHEN 'texas' THEN 'TX' WHEN 'utah' THEN 'UT'
      WHEN 'vermont' THEN 'VT' WHEN 'virginia' THEN 'VA' WHEN 'washington' THEN 'WA' WHEN 'west-virginia' THEN 'WV'
      WHEN 'wisconsin' THEN 'WI' WHEN 'wyoming' THEN 'WY' WHEN 'district-of-columbia' THEN 'DC'
      ELSE NULL
    END
  END;

  IF state_code IS NOT NULL THEN
    RETURN 'state-' || lower(state_code);
  END IF;
  RETURN 'united-states';
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_connect_prospect_research_market()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_slug text;
  selected_id uuid;
BEGIN
  IF NEW.market_id IS NOT NULL OR upper(coalesce(NEW.country,'US')) <> 'US' THEN
    RETURN NEW;
  END IF;

  selected_slug := public.connect_infer_research_market_slug(NEW.city, NEW.state, coalesce(NEW.source_metadata,'{}'::jsonb));
  SELECT id INTO selected_id
  FROM connect_research_markets
  WHERE slug=selected_slug
    AND status IN ('PLANNED','ACTIVE','PAUSED','COMPLETE')
  LIMIT 1;

  IF selected_id IS NOT NULL THEN
    NEW.market_id := selected_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connect_prospects_research_market_assignment ON connect_prospects;
CREATE TRIGGER connect_prospects_research_market_assignment
BEFORE INSERT OR UPDATE OF city,state,country,source_metadata,market_id
ON connect_prospects
FOR EACH ROW
EXECUTE FUNCTION public.assign_connect_prospect_research_market();

UPDATE connect_prospects p
SET market_id=m.id,
    source_metadata=coalesce(p.source_metadata,'{}'::jsonb) || jsonb_build_object(
      'research_market_assignment',jsonb_build_object(
        'market_id',m.id,
        'market_slug',m.slug,
        'market_name',m.name,
        'market_type',m.market_type,
        'assignment_method','DATABASE_BACKFILL',
        'assigned_at',now()
      )
    ),
    updated_at=now()
FROM connect_research_markets m
WHERE p.market_id IS NULL
  AND upper(coalesce(p.country,'US'))='US'
  AND m.slug=public.connect_infer_research_market_slug(p.city,p.state,coalesce(p.source_metadata,'{}'::jsonb));
