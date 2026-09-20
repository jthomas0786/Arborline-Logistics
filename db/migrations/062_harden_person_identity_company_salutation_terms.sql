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
    AND lower(btrim(value)) NOT IN ('master gardener','stewardship taking')
    AND lower(btrim(value)) !~ '\m(about|accounting|administration|administrative|air|arborist|builder|builders|building|buildings|business|certified|cleaner|cleaners|cleaning|commercial|company|construction|contact|contractor|contractors|cooling|customer|customers|department|development|digital|division|engineering|expert|experts|facility|finance|fire|from|government|group|grounds|healthcare|heating|helping|home|house|human|hvac|janitorial|landscape|landscaping|lawn|local|mall|management|mechanical|meet|office|our|owner|partners|personnel|pest|plumber|plumbers|plumbing|president|procurement|professional|professionals|project|properties|property|protection|purchasing|recruiting|regards|residential|resources|restoration|roof|roofer|roofers|roofing|safety|service|services|sincerely|software|solutions|specialist|specialists|sprinkler|sprinklers|staff|staffing|states|stewardship|strip|suppression|team|technician|technicians|technology|technologies|the|trusted|typical|united|usa|workforce)\M'
    AND lower(btrim(value)) !~ '\m(by|ceo|cfo|chief|coo|director|founder|manager|officer|operations|sales|vice)\M';
$function$;
