CREATE OR REPLACE FUNCTION public.connect_contact_name_is_personlike(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    value IS NOT NULL
    AND length(btrim(value)) BETWEEN 4 AND 70
    AND btrim(value) ~ '^[[:alpha:]][[:alpha:]''’.-]*( [[:alpha:]][[:alpha:]''’.-]*){1,4}$'
    AND cardinality(regexp_split_to_array(btrim(value), '[[:space:]]+')) BETWEEN 2 AND 5
    AND lower(btrim(value)) !~ '\m(about|air|arborist|business|certified|cleaner|cleaners|cleaning|commercial|company|contact|contractor|contractors|cooling|customer|customers|expert|experts|facility|fire|from|government|group|grounds|heating|helping|home|house|hvac|janitorial|landscape|landscaping|lawn|local|mall|management|mechanical|meet|office|our|owner|pest|plumber|plumbers|plumbing|president|professional|professionals|protection|recruiting|residential|restoration|roof|roofer|roofers|roofing|safety|service|services|solutions|specialist|specialists|sprinkler|sprinklers|staff|staffing|states|strip|suppression|team|technician|technicians|the|trusted|typical|united|workforce)\M'
    AND lower(btrim(value)) !~ '\m(by|ceo|cfo|chief|coo|director|founder|manager|officer|operations|sales|vice)\M';
$$;

COMMENT ON FUNCTION public.connect_contact_name_is_personlike(text) IS
  'Fail-closed sanity check for researched decision-maker names before native enrichment, mailbox verification, or prepared/sendable outreach drafting.';
