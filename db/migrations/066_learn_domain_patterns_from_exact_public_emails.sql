CREATE OR REPLACE FUNCTION public.connect_learn_public_email_pattern()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE
  v_pattern text;
  v_domain text;
  v_confidence integer;
BEGIN
  IF NEW.email IS NULL OR NEW.contact_name IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.source_kind NOT IN ('PUBLIC_SITE','PUBLIC_PROFILE') THEN
    RETURN NEW;
  END IF;
  IF NEW.email_status IN ('INVALID') THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.identity_confidence,0) < 85 THEN
    RETURN NEW;
  END IF;

  v_pattern := NEW.metadata->>'pattern';
  IF v_pattern NOT IN ('FIRST.LAST','FIRST_LAST','FIRST-LAST','FIRSTLAST','F_LAST','F.LAST','FIRST') THEN
    RETURN NEW;
  END IF;
  v_domain := lower(split_part(NEW.email,'@',2));
  IF v_domain='' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.connect_prospects p
    WHERE p.id=NEW.prospect_id
      AND p.client_id=NEW.client_id
      AND p.contact_name IS NOT NULL
      AND lower(p.contact_name)=lower(NEW.contact_name)
      AND public.connect_contact_name_is_personlike(p.contact_name)
      AND lower(p.domain)=v_domain
  ) THEN
    RETURN NEW;
  END IF;

  v_confidence := CASE WHEN NEW.source_kind='PUBLIC_PROFILE' THEN 82 ELSE 80 END;

  INSERT INTO public.connect_domain_email_patterns
    (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
  VALUES
    (NEW.client_id,v_domain,v_pattern,0,v_confidence,
     jsonb_build_object('public_exact_email_observed',true,'public_source_kind',NEW.source_kind,'source','PUBLIC_EXACT_EMAIL'),now())
  ON CONFLICT (client_id,domain,pattern) DO UPDATE
  SET confidence=GREATEST(public.connect_domain_email_patterns.confidence,excluded.confidence),
      metadata=coalesce(public.connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
      last_observed_at=now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_learn_public_email_pattern_trigger ON public.connect_contact_candidates;
CREATE TRIGGER connect_learn_public_email_pattern_trigger
AFTER INSERT OR UPDATE OF email,email_status,source_kind,contact_name,identity_confidence,metadata
ON public.connect_contact_candidates
FOR EACH ROW
EXECUTE FUNCTION public.connect_learn_public_email_pattern();

INSERT INTO public.connect_domain_email_patterns
  (client_id,domain,pattern,verified_samples,confidence,metadata,last_observed_at)
SELECT c.client_id,
       lower(split_part(c.email,'@',2)) AS domain,
       c.metadata->>'pattern' AS pattern,
       0,
       max(CASE WHEN c.source_kind='PUBLIC_PROFILE' THEN 82 ELSE 80 END),
       jsonb_build_object('public_exact_email_observed',true,'source','PUBLIC_EXACT_EMAIL_BACKFILL','public_samples',count(*)),
       max(c.last_seen_at)
FROM public.connect_contact_candidates c
JOIN public.connect_prospects p ON p.id=c.prospect_id AND p.client_id=c.client_id
WHERE c.source_kind IN ('PUBLIC_SITE','PUBLIC_PROFILE')
  AND c.email IS NOT NULL
  AND c.email_status <> 'INVALID'
  AND coalesce(c.identity_confidence,0)>=85
  AND c.metadata->>'pattern' IN ('FIRST.LAST','FIRST_LAST','FIRST-LAST','FIRSTLAST','F_LAST','F.LAST','FIRST')
  AND p.contact_name IS NOT NULL
  AND lower(p.contact_name)=lower(c.contact_name)
  AND public.connect_contact_name_is_personlike(p.contact_name)
  AND lower(p.domain)=lower(split_part(c.email,'@',2))
GROUP BY c.client_id,lower(split_part(c.email,'@',2)),c.metadata->>'pattern'
ON CONFLICT (client_id,domain,pattern) DO UPDATE
SET confidence=GREATEST(public.connect_domain_email_patterns.confidence,excluded.confidence),
    metadata=coalesce(public.connect_domain_email_patterns.metadata,'{}'::jsonb)||excluded.metadata,
    last_observed_at=GREATEST(public.connect_domain_email_patterns.last_observed_at,excluded.last_observed_at);
