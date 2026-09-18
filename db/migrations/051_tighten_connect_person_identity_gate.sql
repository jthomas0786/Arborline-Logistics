CREATE OR REPLACE FUNCTION public.connect_contact_name_is_personlike(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    value IS NOT NULL
    AND length(btrim(value)) BETWEEN 4 AND 70
    AND btrim(value) ~ '^[[:alpha:]][[:alpha:]''’.-]*( [[:alpha:]][[:alpha:]''’.-]*){1,4}$'
    AND cardinality(regexp_split_to_array(btrim(value), '[[:space:]]+')) BETWEEN 2 AND 5
    AND lower(btrim(value)) !~ '\\m(about|accounting|administration|administrative|air|arborist|business|certified|cleaner|cleaners|cleaning|commercial|company|contact|contractor|contractors|cooling|customer|customers|department|development|digital|division|engineering|expert|experts|facility|finance|fire|from|government|group|grounds|heating|helping|home|house|human|hvac|janitorial|landscape|landscaping|lawn|local|mall|management|mechanical|meet|office|our|owner|pest|plumber|plumbers|plumbing|president|procurement|professional|professionals|project|protection|purchasing|recruiting|residential|resources|restoration|roof|roofer|roofers|roofing|safety|service|services|software|solutions|specialist|specialists|sprinkler|sprinklers|staff|staffing|states|strip|suppression|team|technician|technicians|technology|technologies|the|trusted|typical|united|workforce)\\M'
    AND lower(btrim(value)) !~ '\\m(by|ceo|cfo|chief|coo|director|founder|manager|officer|operations|sales|vice)\\M';
$function$;
