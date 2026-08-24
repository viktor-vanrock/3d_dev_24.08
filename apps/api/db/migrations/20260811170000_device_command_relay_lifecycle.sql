-- migrate:up

ALTER TABLE public.device_commands
    DROP CONSTRAINT IF EXISTS device_commands_status_check;

UPDATE public.device_commands
SET status = CASE status
    WHEN 'acked' THEN 'acknowledged'
    WHEN 'rejected' THEN 'failed'
    ELSE status
END
WHERE status IN ('acked', 'rejected');

ALTER TABLE public.device_commands
    ADD COLUMN IF NOT EXISTS claim_owner text,
    ADD COLUMN IF NOT EXISTS claim_token text,
    ADD COLUMN IF NOT EXISTS generation bigint DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3 NOT NULL,
    ADD COLUMN IF NOT EXISTS lease_timeout_seconds integer DEFAULT 30 NOT NULL,
    ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + interval '24 hours') NOT NULL,
    ADD COLUMN IF NOT EXISTS terminal_error_code text,
    ADD COLUMN IF NOT EXISTS leased_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS acknowledged_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS executed_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS failed_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS expired_at timestamp with time zone;

UPDATE public.device_commands
SET acknowledged_at = COALESCE(acknowledged_at, acked_at, created_at)
WHERE status = 'acknowledged';

UPDATE public.device_commands
SET failed_at = COALESCE(failed_at, acked_at, created_at),
    terminal_error_code = COALESCE(terminal_error_code, 'legacy_rejected')
WHERE status = 'failed';

ALTER TABLE public.device_commands
    ADD CONSTRAINT device_commands_status_check CHECK (status = ANY (ARRAY['queued'::text, 'leased'::text, 'delivered'::text, 'acknowledged'::text, 'executed'::text, 'failed'::text, 'expired'::text])),
    ADD CONSTRAINT device_commands_generation_check CHECK (generation >= 0),
    ADD CONSTRAINT device_commands_attempt_count_check CHECK (attempt_count >= 0 AND attempt_count <= max_attempts),
    ADD CONSTRAINT device_commands_max_attempts_check CHECK (max_attempts >= 1 AND max_attempts <= 100),
    ADD CONSTRAINT device_commands_lease_timeout_seconds_check CHECK (lease_timeout_seconds >= 1 AND lease_timeout_seconds <= 3600),
    ADD CONSTRAINT device_commands_claim_token_check CHECK (claim_token IS NULL OR length(claim_token) >= 32),
    ADD CONSTRAINT device_commands_expiry_after_creation_check CHECK (expires_at >= created_at);

CREATE INDEX IF NOT EXISTS device_commands_relay_claim_idx
    ON public.device_commands (device_id, command_seq, created_at, id)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS device_commands_relay_lease_expiry_idx
    ON public.device_commands (lease_expires_at, id)
    WHERE status IN ('leased', 'delivered', 'acknowledged');

-- migrate:down

DROP INDEX IF EXISTS public.device_commands_relay_lease_expiry_idx;
DROP INDEX IF EXISTS public.device_commands_relay_claim_idx;

ALTER TABLE public.device_commands
    DROP CONSTRAINT IF EXISTS device_commands_expiry_after_creation_check,
    DROP CONSTRAINT IF EXISTS device_commands_claim_token_check,
    DROP CONSTRAINT IF EXISTS device_commands_lease_timeout_seconds_check,
    DROP CONSTRAINT IF EXISTS device_commands_max_attempts_check,
    DROP CONSTRAINT IF EXISTS device_commands_attempt_count_check,
    DROP CONSTRAINT IF EXISTS device_commands_generation_check,
    DROP CONSTRAINT IF EXISTS device_commands_status_check;

UPDATE public.device_commands
SET status = CASE status
    WHEN 'leased' THEN 'queued'
    WHEN 'acknowledged' THEN 'acked'
    WHEN 'executed' THEN 'acked'
    WHEN 'failed' THEN 'rejected'
    WHEN 'expired' THEN 'rejected'
    ELSE status
END
WHERE status IN ('leased', 'acknowledged', 'executed', 'failed', 'expired');

ALTER TABLE public.device_commands
    ADD CONSTRAINT device_commands_status_check CHECK (status = ANY (ARRAY['queued'::text, 'delivered'::text, 'acked'::text, 'rejected'::text]));

ALTER TABLE public.device_commands
    DROP COLUMN IF EXISTS expired_at,
    DROP COLUMN IF EXISTS failed_at,
    DROP COLUMN IF EXISTS executed_at,
    DROP COLUMN IF EXISTS acknowledged_at,
    DROP COLUMN IF EXISTS delivered_at,
    DROP COLUMN IF EXISTS leased_at,
    DROP COLUMN IF EXISTS terminal_error_code,
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS lease_timeout_seconds,
    DROP COLUMN IF EXISTS max_attempts,
    DROP COLUMN IF EXISTS attempt_count,
    DROP COLUMN IF EXISTS lease_expires_at,
    DROP COLUMN IF EXISTS generation,
    DROP COLUMN IF EXISTS claim_token,
    DROP COLUMN IF EXISTS claim_owner;
