-- migrate:up

ALTER TABLE public.users
  DROP CONSTRAINT users_status_check,
  ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'restricted', 'banned', 'deleted'));

INSERT INTO public.users (id, username, status, is_staff, role, handle_confirmed)
VALUES ('00000000-0000-0000-0000-000000000001', '__system__', 'active', false, 'user', true)
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.user_password_credentials
WHERE user_id = '00000000-0000-0000-0000-000000000001';

CREATE TABLE public.sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  type text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  reason_code text NOT NULL,
  reason_note text,
  evidence_url text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  idempotency_key text NOT NULL,
  idempotency_payload_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sanctions_type_check CHECK (type IN ('suspension', 'ban')),
  CONSTRAINT sanctions_state_check CHECK (state IN ('active', 'cancelled', 'expired')),
  CONSTRAINT sanctions_reason_code_check CHECK (reason_code IN ('spam', 'abuse', 'fraud', 'tos_violation', 'security', 'other', 'legacy')),
  CONSTRAINT sanctions_ends_after_starts_check CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT sanctions_cancellation_fields_check CHECK (
    (state = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')
    OR (state <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
  )
);

CREATE UNIQUE INDEX sanctions_one_active_per_user_idx ON public.sanctions (user_id) WHERE state = 'active';
CREATE UNIQUE INDEX sanctions_idempotency_key_idx ON public.sanctions (idempotency_key);
CREATE INDEX sanctions_user_history_idx ON public.sanctions (user_id, created_at DESC);

CREATE TABLE public.sanction_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id uuid NOT NULL REFERENCES public.sanctions(id),
  submitted_by uuid NOT NULL REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  message text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sanction_appeals_message_nonempty_check CHECK (btrim(message) <> ''),
  CONSTRAINT sanction_appeals_state_check CHECK (state IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT sanction_appeals_resolution_fields_check CHECK (
    (state = 'pending' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (
      state IN ('accepted', 'rejected')
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND resolution_note IS NOT NULL
      AND btrim(resolution_note) <> ''
    )
  )
);

CREATE UNIQUE INDEX sanction_appeals_one_pending_per_sanction_idx ON public.sanction_appeals (sanction_id) WHERE state = 'pending';
CREATE INDEX sanction_appeals_sanction_history_idx ON public.sanction_appeals (sanction_id, submitted_at DESC);

-- migrate:down

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sanctions WHERE reason_code <> 'legacy') THEN
    RAISE EXCEPTION 'cannot roll back sanctions foundation while non-legacy sanctions exist';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE status = 'restricted') THEN
    RAISE EXCEPTION 'cannot roll back sanctions foundation while restricted users exist';
  END IF;
END
$$;

DROP TABLE public.sanction_appeals;
DROP TABLE public.sanctions;

DELETE FROM public.users
WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.users
  DROP CONSTRAINT users_status_check,
  ADD CONSTRAINT users_status_check
    CHECK (status IN ('active', 'banned', 'deleted'));
