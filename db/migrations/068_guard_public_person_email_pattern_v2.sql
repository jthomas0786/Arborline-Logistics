CREATE OR REPLACE FUNCTION public.connect_guard_public_person_email_pattern_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  source_name text;
  source_version integer;
BEGIN
  source_name := coalesce(NEW.metadata->>'source','');
  IF source_name <> 'PUBLIC_PERSON_EMAIL_OBSERVATIONS' THEN
    RETURN NEW;
  END IF;

  BEGIN
    source_version := coalesce(nullif(NEW.metadata->>'version','')::integer, 1);
  EXCEPTION WHEN others THEN
    source_version := 1;
  END;

  IF source_version < 2 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_guard_public_person_email_pattern_v2 ON public.connect_domain_email_patterns;
CREATE TRIGGER connect_guard_public_person_email_pattern_v2
BEFORE INSERT OR UPDATE ON public.connect_domain_email_patterns
FOR EACH ROW
EXECUTE FUNCTION public.connect_guard_public_person_email_pattern_v2();

DELETE FROM public.connect_domain_email_patterns
WHERE metadata->>'source'='PUBLIC_PERSON_EMAIL_OBSERVATIONS'
  AND coalesce(nullif(metadata->>'version','')::integer,1) < 2;
