-- migrate:up
CREATE TABLE public.flag_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flag_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, released_at timestamptz, release_reason text, state text NOT NULL DEFAULT 'active',
  CONSTRAINT flag_claims_state_check CHECK (state IN ('active', 'released', 'expired')),
  CONSTRAINT flag_claims_expiry_check CHECK (expires_at > claimed_at),
  CONSTRAINT flag_claims_release_state_check CHECK ((state = 'active' AND released_at IS NULL AND release_reason IS NULL) OR (state IN ('released', 'expired') AND released_at IS NOT NULL))
);
CREATE UNIQUE INDEX flag_claims_one_active_per_flag_idx ON public.flag_claims(flag_id) WHERE state = 'active';
CREATE INDEX flag_claims_moderator_active_idx ON public.flag_claims(moderator_id, expires_at ASC) WHERE state = 'active';
CREATE INDEX flag_claims_expiry_idx ON public.flag_claims(expires_at) WHERE state = 'active';
COMMENT ON TABLE public.flag_claims IS 'Leased moderation claims. Active claims expire after 30 minutes.';
-- migrate:down
DROP TABLE public.flag_claims;
