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
  domain_mx_checked_at timestamptz;
  domain_mx_expires_at timestamptz;
  domain_last_status text;
  domain_next_probe_at timestamptz;
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

  IF raw_email IS NULL OR raw_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' THEN
    RETURN;
  END IF;

  email_domain := lower(split_part(raw_email,'@',2));
  prospect_domain := lower(regexp_replace(split_part(regexp_replace(p.domain,'^https?://','','i'),'/',1),'^www\.','','i'));
  IF email_domain='' OR prospect_domain='' OR email_domain <> prospect_domain THEN
    RETURN;
  END IF;

  SELECT v.checked_at,v.expires_at
    INTO domain_mx_checked_at,domain_mx_expires_at
  FROM public.connect_email_verification_cache v
  WHERE v.client_id=p.client_id
    AND lower(v.domain)=email_domain
    AND v.mx_status='VALID'
    AND (v.expires_at IS NULL OR v.expires_at>now())
  ORDER BY CASE WHEN lower(v.email)=raw_email THEN 1 ELSE 0 END,
           v.checked_at DESC NULLS LAST
  LIMIT 1;
  has_recent_domain_mx := domain_mx_checked_at IS NOT NULL;

  SELECT ds.last_status,ds.next_probe_at
    INTO domain_last_status,domain_next_probe_at
  FROM public.connect_mailbox_domain_state ds
  WHERE ds.client_id=p.client_id AND lower(ds.domain)=email_domain
  LIMIT 1;

  candidate_status := CASE
    WHEN domain_last_status='CATCH_ALL' AND coalesce(domain_next_probe_at,now()+interval '1 minute')>now() THEN 'CATCH_ALL'
    WHEN domain_last_status IN ('TEMPORARY','NETWORK_BLOCKED','UNKNOWN') AND coalesce(domain_next_probe_at,now()-interval '1 minute')>now() THEN 'TEMPORARY'
    WHEN has_recent_domain_mx THEN 'MX_VALID'
    ELSE 'PUBLISHED_UNVERIFIED'
  END;

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
        WHEN public.connect_contact_candidates.email_status IN ('VERIFIED','INVALID') THEN public.connect_contact_candidates.email_status
        WHEN excluded.email_status IN ('CATCH_ALL','TEMPORARY','MX_VALID') THEN excluded.email_status
        ELSE public.connect_contact_candidates.email_status
      END,
      source_url=coalesce(excluded.source_url,public.connect_contact_candidates.source_url),
      evidence=coalesce(public.connect_contact_candidates.evidence,'[]'::jsonb)||excluded.evidence,
      metadata=coalesce(public.connect_contact_candidates.metadata,'{}'::jsonb)||excluded.metadata,
      last_seen_at=now();

  IF has_recent_domain_mx THEN
    INSERT INTO public.connect_email_verification_cache
      (client_id,email,domain,syntax_valid,mx_status,smtp_status,provider_verified,confidence,evidence,checked_at,expires_at)
    VALUES
      (p.client_id,raw_email,email_domain,true,'VALID','UNKNOWN',false,92,
       jsonb_build_object('published_email_fast_lane',jsonb_build_object(
         'source_kind',source_kind_value,'source_url',source_url_value,'materialized_at',now(),
         'mx_evidence','Reused fresh VALID MX evidence for the same company domain; mailbox existence remains unverified.'
       )),domain_mx_checked_at,domain_mx_expires_at)
    ON CONFLICT (client_id,email) DO UPDATE
    SET syntax_valid=true,
        mx_status=CASE WHEN public.connect_email_verification_cache.mx_status='VALID' THEN 'VALID' ELSE excluded.mx_status END,
        confidence=greatest(public.connect_email_verification_cache.confidence,excluded.confidence),
        evidence=coalesce(public.connect_email_verification_cache.evidence,'{}'::jsonb)||excluded.evidence;
  END IF;
END;
$function$;

WITH fast_state AS (
  SELECT c.id,c.email_status,v.mx_status,ds.last_status,ds.next_probe_at
  FROM public.connect_contact_candidates c
  JOIN public.connect_email_verification_cache v
    ON v.client_id=c.client_id AND lower(v.email)=lower(c.email)
  LEFT JOIN public.connect_mailbox_domain_state ds
    ON ds.client_id=c.client_id AND lower(ds.domain)=lower(split_part(c.email,'@',2))
  WHERE c.metadata->>'materialized_by'='PUBLISHED_EMAIL_FAST_LANE'
)
UPDATE public.connect_contact_candidates c
SET email_status=CASE
      WHEN s.email_status IN ('VERIFIED','INVALID') THEN s.email_status
      WHEN s.last_status='CATCH_ALL' AND coalesce(s.next_probe_at,now()+interval '1 minute')>now() THEN 'CATCH_ALL'
      WHEN s.last_status IN ('TEMPORARY','NETWORK_BLOCKED','UNKNOWN') AND coalesce(s.next_probe_at,now()-interval '1 minute')>now() THEN 'TEMPORARY'
      WHEN s.mx_status='VALID' THEN 'MX_VALID'
      ELSE s.email_status
    END,
    last_seen_at=now()
FROM fast_state s
WHERE c.id=s.id;

WITH latest_attempt AS (
  SELECT DISTINCT ON (client_id,lower(email))
         client_id,lower(email) AS email,status,completed_at
  FROM public.connect_mailbox_verification_attempts
  ORDER BY client_id,lower(email),completed_at DESC
)
UPDATE public.connect_email_verification_cache v
SET checked_at=a.completed_at,
    expires_at=CASE
      WHEN a.status='VERIFIED' THEN a.completed_at+interval '180 days'
      WHEN a.status IN ('INVALID','CATCH_ALL') THEN a.completed_at+interval '30 days'
      ELSE a.completed_at+interval '1 day'
    END
FROM latest_attempt a
WHERE v.client_id=a.client_id
  AND lower(v.email)=a.email
  AND EXISTS (
    SELECT 1 FROM public.connect_contact_candidates c
    WHERE c.client_id=v.client_id AND lower(c.email)=lower(v.email)
      AND c.metadata->>'materialized_by'='PUBLISHED_EMAIL_FAST_LANE'
  );

WITH unprobed AS (
  SELECT v.client_id,v.email,v.domain
  FROM public.connect_email_verification_cache v
  JOIN public.connect_contact_candidates c
    ON c.client_id=v.client_id AND lower(c.email)=lower(v.email)
  WHERE c.metadata->>'materialized_by'='PUBLISHED_EMAIL_FAST_LANE'
    AND NOT EXISTS (
      SELECT 1 FROM public.connect_mailbox_verification_attempts a
      WHERE a.client_id=v.client_id AND lower(a.email)=lower(v.email)
    )
), source_times AS (
  SELECT u.client_id,u.email,src.checked_at,src.expires_at
  FROM unprobed u
  CROSS JOIN LATERAL (
    SELECT x.checked_at,x.expires_at
    FROM public.connect_email_verification_cache x
    WHERE x.client_id=u.client_id
      AND lower(x.domain)=lower(u.domain)
      AND lower(x.email)<>lower(u.email)
      AND x.mx_status='VALID'
    ORDER BY x.checked_at DESC NULLS LAST
    LIMIT 1
  ) src
)
UPDATE public.connect_email_verification_cache v
SET checked_at=s.checked_at,
    expires_at=s.expires_at
FROM source_times s
WHERE v.client_id=s.client_id
  AND lower(v.email)=lower(s.email);