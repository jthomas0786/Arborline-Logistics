CREATE OR REPLACE FUNCTION public.connect_materialize_published_contact_candidate(prospect_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  p public.connect_prospects%ROWTYPE;
  raw_email text;
  source_kind_value text;
  source_url_value text;
  identity_confidence_value integer;
  email_domain text;
  prospect_domain text;
  has_recent_domain_mx boolean := false;
  candidate_status text;
BEGIN
  SELECT * INTO p
  FROM public.connect_prospects
  WHERE id=prospect_uuid;

  IF NOT FOUND
     OR p.contact_email IS NOT NULL
     OR p.qualification_status <> 'QUALIFIED'
     OR p.suppression_status <> 'CLEAR'
     OR p.contact_name IS NULL
     OR NOT public.connect_contact_name_is_personlike(p.contact_name)
     OR p.domain IS NULL
     OR (p.source='ARBORLINE_DISCOVERY' AND coalesce(p.source_metadata->'service_fit'->>'status','') <> 'MATCH') THEN
    RETURN;
  END IF;

  -- Prefer manually confirmed public-profile evidence, then exact deep-research
  -- evidence, then the normal public-site researcher. Every path is name-bound.
  IF coalesce(p.source_metadata->'manual_public_profile_research'->>'published_email','') <> ''
     AND regexp_replace(lower(coalesce(p.source_metadata->'manual_public_profile_research'->>'decision_maker_name','')), '[^a-z0-9]+', '', 'g')
         = regexp_replace(lower(p.contact_name), '[^a-z0-9]+', '', 'g') THEN
    raw_email := lower(btrim(p.source_metadata->'manual_public_profile_research'->>'published_email'));
    source_kind_value := 'PUBLIC_PROFILE';
    source_url_value := nullif(p.source_metadata->'manual_public_profile_research'->>'profile_url','');
    identity_confidence_value := 98;
  ELSIF coalesce((p.source_metadata->'deep_published_email_research'->>'exact_identity_match')::boolean,false)
     AND coalesce(p.source_metadata->'deep_published_email_research'->>'published_email','') <> ''
     AND regexp_replace(lower(coalesce(p.source_metadata->'deep_published_email_research'->>'candidate_name','')), '[^a-z0-9]+', '', 'g')
         = regexp_replace(lower(p.contact_name), '[^a-z0-9]+', '', 'g') THEN
    raw_email := lower(btrim(p.source_metadata->'deep_published_email_research'->>'published_email'));
    source_kind_value := CASE
      WHEN upper(coalesce(p.source_metadata->'deep_published_email_research'->>'source_kind',''))='PUBLIC_PROFILE' THEN 'PUBLIC_PROFILE'
      ELSE 'PUBLIC_SITE'
    END;
    source_url_value := nullif(p.source_metadata->'deep_published_email_research'->>'source_url','');
    identity_confidence_value := greatest(90, least(100, coalesce(nullif(p.source_metadata->'public_research'->>'decision_maker_confidence','')::integer,90)));
  ELSIF coalesce(p.source_metadata->'public_research'->>'published_email','') <> ''
     AND regexp_replace(lower(coalesce(p.source_metadata->'public_research'->>'decision_maker_name','')), '[^a-z0-9]+', '', 'g')
         = regexp_replace(lower(p.contact_name), '[^a-z0-9]+', '', 'g') THEN
    raw_email := lower(btrim(p.source_metadata->'public_research'->>'published_email'));
    source_kind_value := CASE
      WHEN upper(coalesce(p.source_metadata->'public_research'->>'decision_maker_source_kind',''))='PUBLIC_PROFILE' THEN 'PUBLIC_PROFILE'
      ELSE 'PUBLIC_SITE'
    END;
    source_url_value := nullif(p.source_metadata->'public_research'->>'source_url','');
    identity_confidence_value := greatest(85, least(100, coalesce(nullif(p.source_metadata->'public_research'->>'decision_maker_confidence','')::integer,85)));
  ELSE
    RETURN;
  END IF;

  IF raw_email IS NULL
     OR raw_email !~ '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'::text COLLATE "C" THEN
    -- PostgreSQL regex is case-sensitive by default; retry with a normalized lower-case pattern.
    IF raw_email IS NULL OR raw_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' THEN
      RETURN;
    END IF;
  END IF;

  email_domain := lower(split_part(raw_email,'@',2));
  prospect_domain := lower(regexp_replace(split_part(regexp_replace(p.domain,'^https?://','','i'),'/',1),'^www\.','','i'));
  IF email_domain='' OR prospect_domain='' OR email_domain <> prospect_domain THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.connect_email_verification_cache v
    WHERE v.client_id=p.client_id
      AND lower(v.domain)=email_domain
      AND v.mx_status='VALID'
      AND (v.expires_at IS NULL OR v.expires_at>now())
  ) INTO has_recent_domain_mx;

  candidate_status := CASE WHEN has_recent_domain_mx THEN 'MX_VALID' ELSE 'PUBLISHED_UNVERIFIED' END;

  INSERT INTO public.connect_contact_candidates
    (client_id,prospect_id,segment_id,market_id,source_kind,contact_name,contact_title,email,
     identity_confidence,email_confidence,email_status,source_url,evidence,metadata,last_seen_at)
  VALUES
    (p.client_id,p.id,p.segment_id,p.market_id,source_kind_value,p.contact_name,p.contact_title,raw_email,
     identity_confidence_value,CASE WHEN has_recent_domain_mx THEN 96 ELSE 92 END,candidate_status,source_url_value,
     jsonb_build_array('Direct email is publicly published, matches the current researched decision-maker identity, and uses the company domain. Mailbox verification is still required before outreach.'),
     jsonb_build_object('materialized_by','PUBLISHED_EMAIL_FAST_LANE','direct_published',true,'identity_bound',true),now())
  ON CONFLICT (prospect_id, lower(email)) WHERE email IS NOT NULL DO UPDATE
  SET source_kind=CASE
        WHEN public.connect_contact_candidates.source_kind IN ('PUBLIC_SITE','PUBLIC_PROFILE') THEN public.connect_contact_candidates.source_kind
        ELSE excluded.source_kind
      END,
      contact_name=excluded.contact_name,
      contact_title=excluded.contact_title,
      identity_confidence=greatest(public.connect_contact_candidates.identity_confidence,excluded.identity_confidence),
      email_confidence=greatest(public.connect_contact_candidates.email_confidence,excluded.email_confidence),
      email_status=CASE
        WHEN public.connect_contact_candidates.email_status='VERIFIED' THEN 'VERIFIED'
        WHEN excluded.email_status='MX_VALID' THEN 'MX_VALID'
        ELSE public.connect_contact_candidates.email_status
      END,
      source_url=coalesce(excluded.source_url,public.connect_contact_candidates.source_url),
      evidence=coalesce(public.connect_contact_candidates.evidence,'[]'::jsonb)||excluded.evidence,
      metadata=coalesce(public.connect_contact_candidates.metadata,'{}'::jsonb)||excluded.metadata,
      last_seen_at=now();

  -- MX validity is a domain-level property. If ArborLine has fresh VALID MX evidence
  -- for another address on this exact company domain, reuse only that MX fact for
  -- the published address. This does NOT claim the individual mailbox exists.
  IF has_recent_domain_mx THEN
    INSERT INTO public.connect_email_verification_cache
      (client_id,email,domain,syntax_valid,mx_status,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
    VALUES
      (p.client_id,raw_email,email_domain,true,'VALID','UNKNOWN',false,92,
       jsonb_build_object('published_email_fast_lane',jsonb_build_object(
         'source_kind',source_kind_value,'source_url',source_url_value,'materialized_at',now(),
         'mx_evidence','Reused fresh VALID MX evidence for the same company domain; mailbox existence remains unverified.'
       )),now(),now()+interval '30 days')
    ON CONFLICT (client_id,email) DO UPDATE
    SET syntax_valid=true,
        mx_status=CASE WHEN public.connect_email_verification_cache.mx_status='VALID' THEN 'VALID' ELSE excluded.mx_status END,
        confidence=greatest(public.connect_email_verification_cache.confidence,excluded.confidence),
        evidence=coalesce(public.connect_email_verification_cache.evidence,'{}'::jsonb)||excluded.evidence,
        checked_at=now(),
        expires_at=greatest(public.connect_email_verification_cache.expires_at,excluded.expires_at);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.connect_materialize_published_contact_candidate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.connect_materialize_published_contact_candidate(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_materialize_published_contact_candidate_trg ON public.connect_prospects;
CREATE TRIGGER connect_materialize_published_contact_candidate_trg
AFTER INSERT OR UPDATE OF source_metadata,contact_name,contact_title,qualification_status,suppression_status,domain
ON public.connect_prospects
FOR EACH ROW
EXECUTE FUNCTION public.connect_materialize_published_contact_candidate_trigger();

-- Backfill only currently qualified, unsuppressed, person-bound prospects.
DO $block$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.connect_prospects
    WHERE contact_email IS NULL
      AND qualification_status='QUALIFIED'
      AND suppression_status='CLEAR'
      AND contact_name IS NOT NULL
      AND public.connect_contact_name_is_personlike(contact_name)
  LOOP
    PERFORM public.connect_materialize_published_contact_candidate(r.id);
  END LOOP;
END;
$block$;