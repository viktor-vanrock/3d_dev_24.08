-- migrate:up

ALTER TABLE public.assistant_runs
    ADD COLUMN IF NOT EXISTS leased_by text,
    ADD COLUMN IF NOT EXISTS lease_generation bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.assistant_runs
    ADD CONSTRAINT assistant_runs_lease_generation_check CHECK (lease_generation >= 0),
    ADD CONSTRAINT assistant_runs_attempts_check CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS assistant_runs_queue_claim_idx
    ON public.assistant_runs (created_at, id)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS assistant_runs_queue_expiry_idx
    ON public.assistant_runs (lease_expires_at, id)
    WHERE status = 'running';

-- migrate:down

DROP INDEX IF EXISTS public.assistant_runs_queue_expiry_idx;
DROP INDEX IF EXISTS public.assistant_runs_queue_claim_idx;

ALTER TABLE public.assistant_runs
    DROP CONSTRAINT IF EXISTS assistant_runs_attempts_check,
    DROP CONSTRAINT IF EXISTS assistant_runs_lease_generation_check,
    DROP COLUMN IF EXISTS lease_generation,
    DROP COLUMN IF EXISTS leased_by;
