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
    AND lower(btrim(value)) !~ '\m(about|accounting|administration|administrative|air|arborist|business|certified|cleaner|cleaners|cleaning|commercial|company|contact|contractor|contractors|cooling|customer|customers|department|development|digital|division|engineering|expert|experts|facility|finance|fire|from|government|group|grounds|healthcare|heating|helping|home|house|human|hvac|janitorial|landscape|landscaping|lawn|local|mall|management|mechanical|meet|office|our|owner|pest|plumber|plumbers|plumbing|president|procurement|professional|professionals|project|protection|purchasing|recruiting|residential|resources|restoration|roof|roofer|roofers|roofing|safety|service|services|software|solutions|specialist|specialists|sprinkler|sprinklers|staff|staffing|states|strip|suppression|team|technician|technicians|technology|technologies|the|trusted|typical|united|workforce)\M'
    AND lower(btrim(value)) !~ '\m(by|ceo|cfo|chief|coo|director|founder|manager|officer|operations|sales|vice)\M';
$function$;

-- Clear the known organizational label that previously slipped through the
-- person gate. The prospect remains researchable, but cannot be verified or
-- promoted until a real person is found.
UPDATE public.connect_prepared_outreach_drafts d
SET status='CANCELLED',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'cancelled_reason','PERSON_IDENTITY_GATE_HARDENED',
      'cancelled_at',now()
    ),
    updated_at=now()
FROM public.connect_prospects p
WHERE d.prospect_id=p.id
  AND d.status='PREPARED'
  AND lower(btrim(p.contact_name))='judge healthcare';

DELETE FROM public.connect_contact_candidates c
USING public.connect_prospects p
WHERE c.prospect_id=p.id
  AND lower(btrim(p.contact_name))='judge healthcare';

UPDATE public.connect_prospects
SET contact_name=NULL,
    contact_title=NULL,
    outreach_status='NOT_READY',
    source_metadata=coalesce(source_metadata,'{}'::jsonb) || jsonb_build_object(
      'identity_gate_rejected_at',now(),
      'identity_gate_rejected_value','Judge Healthcare',
      'identity_gate_rejected_reason','ORGANIZATIONAL_HEALTHCARE_LABEL'
    ),
    updated_at=now()
WHERE lower(btrim(contact_name))='judge healthcare'
  AND contact_email IS NULL;
