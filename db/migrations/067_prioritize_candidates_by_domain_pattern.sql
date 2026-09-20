CREATE OR REPLACE FUNCTION public.connect_prioritize_domain_pattern_candidates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_candidate_confidence integer;
BEGIN
  IF NEW.pattern NOT IN ('FIRST.LAST','FIRST_LAST','FIRST-LAST','FIRSTLAST','F_LAST','F.LAST','FIRST') THEN
    RETURN NEW;
  END IF;

  v_candidate_confidence := greatest(50, least(89, coalesce(NEW.confidence,0)-8));

  UPDATE public.connect_contact_candidates c
  SET email_confidence=greatest(coalesce(c.email_confidence,0),v_candidate_confidence),
      metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object(
        'domain_pattern_priority',jsonb_build_object(
          'pattern',NEW.pattern,
          'pattern_confidence',NEW.confidence,
          'verified_samples',NEW.verified_samples,
          'candidate_confidence',v_candidate_confidence,
          'observed_at',now()
        )
      )
  FROM public.connect_prospects p
  WHERE c.prospect_id=p.id
    AND c.client_id=NEW.client_id
    AND p.client_id=NEW.client_id
    AND lower(split_part(c.email,'@',2))=lower(NEW.domain)
    AND c.source_kind='LEARNED_PATTERN'
    AND c.metadata->>'pattern'=NEW.pattern
    AND c.email_status IN ('MX_VALID','SYNTAX_VALID','TEMPORARY','UNKNOWN')
    AND c.verified_at IS NULL
    AND p.contact_email IS NULL
    AND p.contact_name IS NOT NULL
    AND lower(c.contact_name)=lower(p.contact_name)
    AND public.connect_contact_name_is_personlike(p.contact_name);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_prioritize_domain_pattern_candidates_trigger ON public.connect_domain_email_patterns;
CREATE TRIGGER connect_prioritize_domain_pattern_candidates_trigger
AFTER INSERT OR UPDATE OF pattern,confidence,verified_samples,last_observed_at
ON public.connect_domain_email_patterns
FOR EACH ROW
EXECUTE FUNCTION public.connect_prioritize_domain_pattern_candidates();

UPDATE public.connect_contact_candidates c
SET email_confidence=greatest(
      coalesce(c.email_confidence,0),
      greatest(50,least(89,coalesce(dp.confidence,0)-8))
    ),
    metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object(
      'domain_pattern_priority',jsonb_build_object(
        'pattern',dp.pattern,
        'pattern_confidence',dp.confidence,
        'verified_samples',dp.verified_samples,
        'candidate_confidence',greatest(50,least(89,coalesce(dp.confidence,0)-8)),
        'observed_at',now()
      )
    )
FROM public.connect_domain_email_patterns dp,
     public.connect_prospects p
WHERE c.prospect_id=p.id
  AND dp.client_id=c.client_id
  AND p.client_id=c.client_id
  AND lower(dp.domain)=lower(split_part(c.email,'@',2))
  AND c.source_kind='LEARNED_PATTERN'
  AND c.metadata->>'pattern'=dp.pattern
  AND c.email_status IN ('MX_VALID','SYNTAX_VALID','TEMPORARY','UNKNOWN')
  AND c.verified_at IS NULL
  AND p.contact_email IS NULL
  AND p.contact_name IS NOT NULL
  AND lower(c.contact_name)=lower(p.contact_name)
  AND public.connect_contact_name_is_personlike(p.contact_name);
