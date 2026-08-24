-- migrate:up

ALTER TABLE public.model_revisions
    ADD COLUMN IF NOT EXISTS leased_by text,
    ADD COLUMN IF NOT EXISTS lease_generation bigint DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone;

ALTER TABLE public.model_revisions
    ADD CONSTRAINT model_revisions_lease_generation_check CHECK (lease_generation >= 0),
    ADD CONSTRAINT model_revisions_attempts_check CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS model_revisions_queue_claim_idx
    ON public.model_revisions (created_at, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS model_revisions_queue_expiry_idx
    ON public.model_revisions (lease_expires_at, id)
    WHERE status = 'processing';

-- migrate:down

DROP INDEX IF EXISTS public.model_revisions_queue_expiry_idx;
DROP INDEX IF EXISTS public.model_revisions_queue_claim_idx;

ALTER TABLE public.model_revisions
    DROP CONSTRAINT IF EXISTS model_revisions_attempts_check,
    DROP CONSTRAINT IF EXISTS model_revisions_lease_generation_check,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS attempts,
    DROP COLUMN IF EXISTS lease_generation,
    DROP COLUMN IF EXISTS leased_by;
