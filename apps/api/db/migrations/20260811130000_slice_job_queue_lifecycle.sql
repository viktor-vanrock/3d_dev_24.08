-- migrate:up

ALTER TABLE public.slice_jobs
    ADD COLUMN IF NOT EXISTS leased_by text,
    ADD COLUMN IF NOT EXISTS lease_generation bigint DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS lifecycle_attempts integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone;

ALTER TABLE public.slice_jobs
    ADD CONSTRAINT slice_jobs_lease_generation_check CHECK (lease_generation >= 0),
    ADD CONSTRAINT slice_jobs_lifecycle_attempts_check CHECK (lifecycle_attempts >= 0);

COMMENT ON COLUMN public.slice_jobs.attempt_count IS
    'Domain/user retry number archived in slice_job_attempts; not a worker lease-acquisition counter.';
COMMENT ON COLUMN public.slice_jobs.lifecycle_attempts IS
    'Worker lifecycle acquisitions: first claim and each successful expired-lease takeover.';

CREATE INDEX IF NOT EXISTS slice_jobs_queue_claim_idx
    ON public.slice_jobs (created_at, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS slice_jobs_queue_expiry_idx
    ON public.slice_jobs (lease_expires_at, id)
    WHERE status = 'processing';

-- migrate:down

DROP INDEX IF EXISTS public.slice_jobs_queue_expiry_idx;
DROP INDEX IF EXISTS public.slice_jobs_queue_claim_idx;

COMMENT ON COLUMN public.slice_jobs.attempt_count IS NULL;

ALTER TABLE public.slice_jobs
    DROP CONSTRAINT IF EXISTS slice_jobs_lifecycle_attempts_check,
    DROP CONSTRAINT IF EXISTS slice_jobs_lease_generation_check,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS lifecycle_attempts,
    DROP COLUMN IF EXISTS lease_generation,
    DROP COLUMN IF EXISTS leased_by;
