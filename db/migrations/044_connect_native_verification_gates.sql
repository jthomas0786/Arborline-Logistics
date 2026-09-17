-- Centralize verified-contact evidence and keep paid-provider fallback behind
-- ArborLine-native mailbox verification. This migration does not enable provider
-- spend, approve outreach, queue messages, or send email.

CREATE OR REPLACE FUNCTION public.connect_contact_is_verified(p public.connect_prospects)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.contact_email IS NOT NULL
    AND (
      (
        upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='PROSPEO'
        AND upper(coalesce(p.source_metadata->>'email_status',''))='VERIFIED'
      )
      OR (
        upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='HUNTER'
        AND upper(coalesce(p.source_metadata->>'email_status','')) IN ('VALID','VERIFIED')
      )
      OR (
        lower(coalesce(p.source_metadata->'hunter_verification'->>'status',''))='valid'
        AND lower(coalesce(p.source_metadata->'hunter_verification'->>'email',''))=lower(p.contact_email)
      )
      OR lower(coalesce(p.source_metadata->'hunter_email_finder'->>'verification_status','')) IN ('valid','verified')
      OR (
        upper(coalesce(p.source_metadata->>'contact_enrichment_provider',''))='ARBORLINE_NATIVE'
        AND upper(coalesce(p.source_metadata->>'email_status',''))='VERIFIED'
        AND upper(coalesce(p.source_metadata->'native_mailbox_verification'->>'status',''))='VERIFIED'
        AND lower(coalesce(p.source_metadata->'native_mailbox_verification'->>'email',''))=lower(p.contact_email)
        AND lower(coalesce(p.source_metadata->'native_mailbox_verification'->>'catch_all','true'))='false'
        AND upper(coalesce(p.source_metadata->'native_mailbox_verification'->>'method',''))='SMTP_RCPT_WITH_CATCH_ALL_CONTROL'
        AND EXISTS (
          SELECT 1
          FROM public.connect_contact_candidates cc
          WHERE cc.client_id=p.client_id
            AND cc.prospect_id=p.id
            AND lower(cc.email)=lower(p.contact_email)
            AND cc.email_status='VERIFIED'
            AND cc.verified_at IS NOT NULL
        )
        AND EXISTS (
          SELECT 1
          FROM public.connect_email_verification_cache ev
          WHERE ev.client_id=p.client_id
            AND lower(ev.email)=lower(p.contact_email)
            AND ev.smtp_status='VALID'
            AND ev.confidence>=95
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.connect_native_provider_fallback_allowed(p_prospect_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  latest_status text;
  has_verified boolean := false;
  has_probeable boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.connect_contact_candidates cc
    WHERE cc.prospect_id=p_prospect_id
      AND cc.email_status='VERIFIED'
      AND cc.verified_at IS NOT NULL
  ) INTO has_verified;

  IF has_verified THEN
    RETURN false;
  END IF;

  SELECT status
  INTO latest_status
  FROM public.connect_mailbox_verification_attempts
  WHERE prospect_id=p_prospect_id
  ORDER BY completed_at DESC,id DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.connect_contact_candidates cc
    WHERE cc.prospect_id=p_prospect_id
      AND cc.email IS NOT NULL
      AND cc.identity_confidence>=85
      AND cc.email_confidence>=50
      AND cc.email_status IN ('MX_VALID','TEMPORARY','UNKNOWN')
  ) INTO has_probeable;

  -- Native enrichment produced a real mailbox candidate but it has not been
  -- tried yet. Do not spend provider credits while ArborLine can still verify it.
  IF latest_status IS NULL THEN
    RETURN NOT has_probeable;
  END IF;

  -- Transient/network conditions must retry rather than immediately spend.
  IF latest_status IN ('TEMPORARY','NETWORK_BLOCKED','DEFERRED') THEN
    RETURN false;
  END IF;

  -- UNKNOWN means the remote mail system deliberately did not give us a reliable
  -- mailbox verdict (common with Microsoft-hosted domains). CATCH_ALL similarly
  -- cannot be resolved safely from address guessing, so provider fallback is valid.
  IF latest_status IN ('UNKNOWN','CATCH_ALL') THEN
    RETURN true;
  END IF;

  -- After an explicit invalid address, try any remaining native variants first.
  IF latest_status='INVALID' THEN
    RETURN NOT has_probeable;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_connect_native_provider_fallback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF coalesce(NEW.source_metadata,'{}'::jsonb) ? 'native_contact_enrichment' THEN
    allowed := public.connect_native_provider_fallback_allowed(NEW.id);
    NEW.source_metadata := jsonb_set(
      coalesce(NEW.source_metadata,'{}'::jsonb),
      '{native_contact_enrichment,provider_fallback_recommended}',
      to_jsonb(allowed),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connect_native_provider_fallback_guard ON public.connect_prospects;
CREATE TRIGGER connect_native_provider_fallback_guard
BEFORE INSERT OR UPDATE OF source_metadata ON public.connect_prospects
FOR EACH ROW
EXECUTE FUNCTION public.enforce_connect_native_provider_fallback();

CREATE OR REPLACE FUNCTION public.refresh_connect_native_provider_fallback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  target_prospect_id uuid;
  allowed boolean;
BEGIN
  target_prospect_id := coalesce(NEW.prospect_id, OLD.prospect_id);
  IF target_prospect_id IS NULL THEN
    RETURN coalesce(NEW,OLD);
  END IF;

  allowed := public.connect_native_provider_fallback_allowed(target_prospect_id);
  UPDATE public.connect_prospects p
  SET source_metadata=jsonb_set(
        coalesce(p.source_metadata,'{}'::jsonb),
        '{native_contact_enrichment,provider_fallback_recommended}',
        to_jsonb(allowed),
        true
      ),
      updated_at=now()
  WHERE p.id=target_prospect_id
    AND coalesce(p.source_metadata,'{}'::jsonb) ? 'native_contact_enrichment';

  RETURN coalesce(NEW,OLD);
END;
$$;

DROP TRIGGER IF EXISTS connect_mailbox_attempt_refresh_provider_fallback ON public.connect_mailbox_verification_attempts;
CREATE TRIGGER connect_mailbox_attempt_refresh_provider_fallback
AFTER INSERT OR UPDATE OF status ON public.connect_mailbox_verification_attempts
FOR EACH ROW
EXECUTE FUNCTION public.refresh_connect_native_provider_fallback();

-- Correct any native-enrichment rows created before this guard existed.
UPDATE public.connect_prospects p
SET source_metadata=jsonb_set(
      coalesce(p.source_metadata,'{}'::jsonb),
      '{native_contact_enrichment,provider_fallback_recommended}',
      to_jsonb(public.connect_native_provider_fallback_allowed(p.id)),
      true
    ),
    updated_at=now()
WHERE coalesce(p.source_metadata,'{}'::jsonb) ? 'native_contact_enrichment';

REVOKE ALL ON FUNCTION public.connect_contact_is_verified(public.connect_prospects) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.connect_native_provider_fallback_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connect_contact_is_verified(public.connect_prospects) TO service_role;
GRANT EXECUTE ON FUNCTION public.connect_native_provider_fallback_allowed(uuid) TO service_role;
