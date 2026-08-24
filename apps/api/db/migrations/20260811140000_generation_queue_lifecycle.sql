-- migrate:up

ALTER TABLE public.generations
    ADD COLUMN IF NOT EXISTS leased_by text,
    ADD COLUMN IF NOT EXISTS lease_generation bigint DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone;

ALTER TABLE public.generations
    ADD CONSTRAINT generations_lease_generation_check CHECK (lease_generation >= 0),
    ADD CONSTRAINT generations_attempts_check CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS generations_queue_claim_idx
    ON public.generations (created_at, id)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS generations_queue_expiry_idx
    ON public.generations (lease_expires_at, id)
    WHERE status = 'running';

-- migrate:down

DROP INDEX IF EXISTS public.generations_queue_expiry_idx;
DROP INDEX IF EXISTS public.generations_queue_claim_idx;

ALTER TABLE public.generations
    DROP CONSTRAINT IF EXISTS generations_attempts_check,
    DROP CONSTRAINT IF EXISTS generations_lease_generation_check,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS lease_generation,
    DROP COLUMN IF EXISTS leased_by;
