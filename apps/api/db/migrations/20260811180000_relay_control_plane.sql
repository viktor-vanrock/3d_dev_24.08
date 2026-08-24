-- migrate:up

ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS relay_certificate_fingerprint_sha256 text,
    ADD COLUMN IF NOT EXISTS authorization_revision bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.agents
    ADD CONSTRAINT agents_relay_certificate_fingerprint_check CHECK (relay_certificate_fingerprint_sha256 IS NULL OR relay_certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT agents_authorization_revision_check CHECK (authorization_revision >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS agents_relay_certificate_fingerprint_idx
    ON public.agents (relay_certificate_fingerprint_sha256)
    WHERE relay_certificate_fingerprint_sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.relay_agent_revoke_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason THEN
        NEW.authorization_revision := OLD.authorization_revision + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER agents_relay_revoke_revision_trigger
    BEFORE UPDATE ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.relay_agent_revoke_revision();

CREATE OR REPLACE FUNCTION public.bump_relay_device_authorization_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE public.agents SET authorization_revision = authorization_revision + 1 WHERE id = OLD.agent_id;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        UPDATE public.agents SET authorization_revision = authorization_revision + 1 WHERE id = NEW.agent_id;
        RETURN NEW;
    END IF;
    IF OLD.agent_id IS DISTINCT FROM NEW.agent_id THEN
        UPDATE public.agents SET authorization_revision = authorization_revision + 1 WHERE id = OLD.agent_id;
        UPDATE public.agents SET authorization_revision = authorization_revision + 1 WHERE id = NEW.agent_id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_printers_relay_authorization_revision_trigger
    AFTER INSERT OR UPDATE OF agent_id OR DELETE ON public.user_printers
    FOR EACH ROW EXECUTE FUNCTION public.bump_relay_device_authorization_revision();

CREATE TABLE IF NOT EXISTS public.relay_gateway_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    gateway_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    connection_id text NOT NULL,
    certificate_fingerprint_sha256 text NOT NULL,
    generation bigint NOT NULL,
    authorization_revision bigint NOT NULL,
    state text DEFAULT 'active' NOT NULL,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    close_reason text,
    CONSTRAINT relay_gateway_sessions_connection_id_check CHECK (length(connection_id) BETWEEN 1 AND 128),
    CONSTRAINT relay_gateway_sessions_fingerprint_check CHECK (certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
    CONSTRAINT relay_gateway_sessions_generation_check CHECK (generation >= 1),
    CONSTRAINT relay_gateway_sessions_authorization_revision_check CHECK (authorization_revision >= 0),
    CONSTRAINT relay_gateway_sessions_state_check CHECK (state IN ('active','closed')),
    CONSTRAINT relay_gateway_sessions_close_check CHECK ((state='active' AND closed_at IS NULL AND close_reason IS NULL) OR (state='closed' AND closed_at IS NOT NULL AND close_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS relay_gateway_sessions_active_gateway_idx
    ON public.relay_gateway_sessions (gateway_id)
    WHERE state='active';

CREATE INDEX IF NOT EXISTS relay_gateway_sessions_revalidate_idx
    ON public.relay_gateway_sessions (state, gateway_id, generation);

CREATE TABLE IF NOT EXISTS public.relay_internal_operations (
    operation_type text NOT NULL,
    operation_id text NOT NULL,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + interval '24 hours') NOT NULL,
    PRIMARY KEY (operation_type, operation_id),
    CONSTRAINT relay_internal_operations_type_check CHECK (length(operation_type) BETWEEN 1 AND 64),
    CONSTRAINT relay_internal_operations_id_check CHECK (length(operation_id) BETWEEN 8 AND 128),
    CONSTRAINT relay_internal_operations_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT relay_internal_operations_response_check CHECK (jsonb_typeof(response)='object'),
    CONSTRAINT relay_internal_operations_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS relay_internal_operations_expiry_idx
    ON public.relay_internal_operations (expires_at);

ALTER TABLE public.device_transfers
    ADD COLUMN IF NOT EXISTS object_key text,
    ADD COLUMN IF NOT EXISTS object_version text,
    ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'application/octet-stream' NOT NULL,
    ADD COLUMN IF NOT EXISTS source_ready_at timestamp with time zone;

ALTER TABLE public.device_transfers
    ADD CONSTRAINT device_transfers_object_key_check CHECK (object_key IS NULL OR length(object_key) BETWEEN 1 AND 1024),
    ADD CONSTRAINT device_transfers_object_version_check CHECK (object_version IS NULL OR length(object_version) BETWEEN 1 AND 256),
    ADD CONSTRAINT device_transfers_content_type_check CHECK (length(content_type) BETWEEN 1 AND 128),
    ADD CONSTRAINT device_transfers_source_tuple_check CHECK ((object_key IS NULL AND object_version IS NULL AND source_ready_at IS NULL) OR (object_key IS NOT NULL AND object_version IS NOT NULL AND source_ready_at IS NOT NULL AND sha256 IS NOT NULL));

-- migrate:down

ALTER TABLE public.device_transfers
    DROP CONSTRAINT IF EXISTS device_transfers_source_tuple_check,
    DROP CONSTRAINT IF EXISTS device_transfers_content_type_check,
    DROP CONSTRAINT IF EXISTS device_transfers_object_version_check,
    DROP CONSTRAINT IF EXISTS device_transfers_object_key_check,
    DROP COLUMN IF EXISTS source_ready_at,
    DROP COLUMN IF EXISTS content_type,
    DROP COLUMN IF EXISTS object_version,
    DROP COLUMN IF EXISTS object_key;

DROP INDEX IF EXISTS public.relay_internal_operations_expiry_idx;
DROP TABLE IF EXISTS public.relay_internal_operations;
DROP INDEX IF EXISTS public.relay_gateway_sessions_revalidate_idx;
DROP INDEX IF EXISTS public.relay_gateway_sessions_active_gateway_idx;
DROP TABLE IF EXISTS public.relay_gateway_sessions;
DROP INDEX IF EXISTS public.agents_relay_certificate_fingerprint_idx;

DROP TRIGGER IF EXISTS user_printers_relay_authorization_revision_trigger ON public.user_printers;
DROP FUNCTION IF EXISTS public.bump_relay_device_authorization_revision();
DROP TRIGGER IF EXISTS agents_relay_revoke_revision_trigger ON public.agents;
DROP FUNCTION IF EXISTS public.relay_agent_revoke_revision();

ALTER TABLE public.agents
    DROP CONSTRAINT IF EXISTS agents_authorization_revision_check,
    DROP CONSTRAINT IF EXISTS agents_relay_certificate_fingerprint_check,
    DROP COLUMN IF EXISTS authorization_revision,
    DROP COLUMN IF EXISTS relay_certificate_fingerprint_sha256;
