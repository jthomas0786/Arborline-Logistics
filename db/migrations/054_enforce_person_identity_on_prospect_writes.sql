CREATE OR REPLACE FUNCTION public.connect_enforce_person_identity_on_prospect_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  rejected_name text;
BEGIN
  IF NEW.contact_name IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.contact_name IS NOT DISTINCT FROM OLD.contact_name THEN
    RETURN NEW;
  END IF;

  IF public.connect_contact_name_is_personlike(NEW.contact_name) THEN
    RETURN NEW;
  END IF;

  rejected_name := btrim(NEW.contact_name);
  NEW.source_metadata := coalesce(NEW.source_metadata,'{}'::jsonb) || jsonb_build_object(
    'identity_gate_rejected_at', now(),
    'identity_gate_rejected_value', rejected_name,
    'identity_gate_rejected_reason', 'NON_PERSON_CONTACT_LABEL'
  );
  NEW.contact_name := NULL;
  NEW.contact_title := NULL;

  -- Research-stage identities must not become outreach-ready merely because a
  -- parser proposed a role-like or organization-like label. Existing verified
  -- email fields are not modified by this trigger; downstream send gates remain
  -- authoritative for already-established contacts.
  IF NEW.contact_email IS NULL THEN
    NEW.outreach_status := 'NOT_READY';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_prospect_person_identity_guard ON public.connect_prospects;
CREATE TRIGGER connect_prospect_person_identity_guard
BEFORE INSERT OR UPDATE OF contact_name ON public.connect_prospects
FOR EACH ROW
EXECUTE FUNCTION public.connect_enforce_person_identity_on_prospect_write();
