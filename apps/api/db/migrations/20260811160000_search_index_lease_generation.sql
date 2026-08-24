-- migrate:up

ALTER TABLE public.search_index_jobs
    ADD COLUMN IF NOT EXISTS lease_generation bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.search_index_jobs
    ADD CONSTRAINT search_index_jobs_lease_generation_check CHECK (lease_generation >= 0);

CREATE INDEX IF NOT EXISTS search_index_jobs_queue_expiry_idx
    ON public.search_index_jobs (leased_until, id)
    WHERE status = 'running';

-- migrate:down

DROP INDEX IF EXISTS public.search_index_jobs_queue_expiry_idx;

ALTER TABLE public.search_index_jobs
    DROP CONSTRAINT IF EXISTS search_index_jobs_lease_generation_check,
    DROP COLUMN IF EXISTS lease_generation;
