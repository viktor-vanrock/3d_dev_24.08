-- migrate:up
CREATE TABLE public.moderation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flag_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE RESTRICT,
  moderator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, action text NOT NULL, reason_code text NOT NULL,
  reason_note text, linked_restriction_id uuid, linked_sanction_id uuid REFERENCES public.sanctions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT, reversal_reason text,
  CONSTRAINT moderation_decisions_action_check CHECK (action IN ('approve', 'hide', 'delete', 'restrict', 'sanction', 'dismiss')),
  CONSTRAINT moderation_decisions_reason_code_check CHECK (reason_code IN ('illegal', 'copyright', 'spam', 'harassment', 'abuse', 'other')),
  CONSTRAINT moderation_decisions_note_required_check CHECK (action IN ('approve', 'dismiss') OR btrim(coalesce(reason_note, '')) <> ''),
  CONSTRAINT moderation_decisions_reversal_check CHECK ((reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL) OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND btrim(reversal_reason) <> ''))
);
CREATE UNIQUE INDEX moderation_decisions_idempotency_key_idx ON public.moderation_decisions(idempotency_key);
CREATE UNIQUE INDEX moderation_decisions_one_active_per_flag_idx ON public.moderation_decisions(flag_id) WHERE reversed_at IS NULL;
CREATE INDEX moderation_decisions_flag_idx ON public.moderation_decisions(flag_id, created_at DESC);
CREATE INDEX moderation_decisions_moderator_idx ON public.moderation_decisions(moderator_id, created_at DESC);
COMMENT ON TABLE public.moderation_decisions IS 'Append-only moderation decisions.';
-- migrate:down
DROP TABLE public.moderation_decisions;
