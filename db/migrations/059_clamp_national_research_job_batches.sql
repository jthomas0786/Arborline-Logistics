CREATE OR REPLACE FUNCTION public.connect_clamp_national_research_job_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  requested_limit integer;
BEGIN
  IF NEW.worker_type = 'RESEARCH'
     AND coalesce(NEW.payload->>'national','false') = 'true' THEN
    BEGIN
      requested_limit := coalesce((NEW.payload->>'limit')::integer, 3);
    EXCEPTION WHEN invalid_text_representation THEN
      requested_limit := 3;
    END;

    IF requested_limit > 3 THEN
      NEW.payload := jsonb_set(coalesce(NEW.payload,'{}'::jsonb), '{limit}', '3'::jsonb, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_national_research_job_limit_guard ON public.connect_worker_jobs;
CREATE TRIGGER connect_national_research_job_limit_guard
BEFORE INSERT OR UPDATE OF worker_type, payload ON public.connect_worker_jobs
FOR EACH ROW
EXECUTE FUNCTION public.connect_clamp_national_research_job_limit();

UPDATE public.connect_worker_jobs
SET payload=jsonb_set(coalesce(payload,'{}'::jsonb),'{limit}','3'::jsonb,true),
    updated_at=now()
WHERE worker_type='RESEARCH'
  AND coalesce(payload->>'national','false')='true'
  AND status IN ('QUEUED','RETRY','RUNNING')
  AND coalesce((payload->>'limit')::integer,3)>3;
