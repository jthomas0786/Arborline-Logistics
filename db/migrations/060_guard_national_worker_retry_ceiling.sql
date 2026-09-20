CREATE OR REPLACE FUNCTION public.connect_guard_national_worker_retry_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')
     AND NEW.status IN ('QUEUED','RETRY')
     AND coalesce(NEW.attempts,0) >= coalesce(NEW.max_attempts,0) THEN
    NEW.status := 'FAILED';
    NEW.completed_at := coalesce(NEW.completed_at, now());
    NEW.locked_at := NULL;
    NEW.locked_by := NULL;
    NEW.heartbeat_at := NULL;
    NEW.last_error := coalesce(NULLIF(NEW.last_error,''), 'National worker retry ceiling exhausted.');
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS connect_national_worker_retry_ceiling_guard ON public.connect_worker_jobs;
CREATE TRIGGER connect_national_worker_retry_ceiling_guard
BEFORE INSERT OR UPDATE OF worker_type,status,attempts,max_attempts ON public.connect_worker_jobs
FOR EACH ROW
EXECUTE FUNCTION public.connect_guard_national_worker_retry_ceiling();

CREATE OR REPLACE FUNCTION public.connect_close_exhausted_national_worker_runs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')
     AND NEW.status='FAILED'
     AND coalesce(NEW.attempts,0) >= coalesce(NEW.max_attempts,0) THEN
    UPDATE public.connect_worker_runs
    SET status='FAILED',
        error_message=coalesce(NULLIF(error_message,''), coalesce(NULLIF(NEW.last_error,''), 'National worker retry ceiling exhausted.')),
        completed_at=coalesce(completed_at,now())
    WHERE job_id=NEW.id
      AND status='RUNNING';
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS connect_national_worker_retry_ceiling_runs ON public.connect_worker_jobs;
CREATE TRIGGER connect_national_worker_retry_ceiling_runs
AFTER INSERT OR UPDATE OF worker_type,status,attempts,max_attempts ON public.connect_worker_jobs
FOR EACH ROW
EXECUTE FUNCTION public.connect_close_exhausted_national_worker_runs();

UPDATE public.connect_worker_jobs
SET status='FAILED',
    completed_at=coalesce(completed_at,now()),
    locked_at=NULL,
    locked_by=NULL,
    heartbeat_at=NULL,
    last_error=coalesce(NULLIF(last_error,''),'National worker retry ceiling exhausted.'),
    updated_at=now()
WHERE worker_type IN ('COORDINATE','RESEARCH','NATIVE_ENRICH','PROVIDER_ENRICH')
  AND status IN ('QUEUED','RETRY')
  AND coalesce(attempts,0) >= coalesce(max_attempts,0);
