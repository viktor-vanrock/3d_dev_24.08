-- migrate:up

ALTER TABLE public.device_enroll_codes
    ADD COLUMN IF NOT EXISTS credential_kind text DEFAULT 'enrollment' NOT NULL;

ALTER TABLE public.device_enroll_codes
    ADD CONSTRAINT device_enroll_codes_credential_kind_check CHECK (credential_kind IN ('enrollment','recovery'));

CREATE TABLE IF NOT EXISTS public.device_enrollment_audit (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    credential_id uuid REFERENCES public.device_enroll_codes(id) ON DELETE SET NULL,
    owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    device_id uuid REFERENCES public.user_printers(id) ON DELETE SET NULL,
    event_type text NOT NULL CHECK (event_type IN ('credential.created','credential.revoked','credential.consumed','identity.issued')),
    meta jsonb DEFAULT '{}'::jsonb NOT NULL CHECK (jsonb_typeof(meta)='object'),
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS device_enrollment_audit_credential_idx ON public.device_enrollment_audit (credential_id, created_at);

-- migrate:down

DROP INDEX IF EXISTS public.device_enrollment_audit_credential_idx;
DROP TABLE IF EXISTS public.device_enrollment_audit;
ALTER TABLE public.device_enroll_codes DROP CONSTRAINT IF EXISTS device_enroll_codes_credential_kind_check;
ALTER TABLE public.device_enroll_codes DROP COLUMN IF EXISTS credential_kind;
