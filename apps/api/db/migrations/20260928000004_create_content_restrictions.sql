-- migrate:up
CREATE TABLE public.content_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, subject_id uuid NOT NULL,
  restriction_type text NOT NULL, scope text NOT NULL DEFAULT 'public', started_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), lifted_at timestamptz, lifted_by uuid REFERENCES public.users(id) ON DELETE RESTRICT, lift_reason text,
  CONSTRAINT content_restrictions_subject_type_check CHECK (subject_type IN ('make', 'model', 'post', 'thread', 'comment')),
  CONSTRAINT content_restrictions_type_check CHECK (restriction_type IN ('hidden', 'locked', 'deleted')),
  CONSTRAINT content_restrictions_scope_check CHECK (scope IN ('public', 'community', 'author_only')),
  CONSTRAINT content_restrictions_ends_after_starts_check CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT content_restrictions_lift_fields_check CHECK ((lifted_at IS NULL AND lifted_by IS NULL AND lift_reason IS NULL) OR (lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND btrim(lift_reason) <> ''))
);
CREATE UNIQUE INDEX content_restrictions_idempotency_key_idx ON public.content_restrictions(idempotency_key);
CREATE UNIQUE INDEX content_restrictions_one_active_kind_idx ON public.content_restrictions(subject_type, subject_id, restriction_type) WHERE lifted_at IS NULL;
CREATE INDEX content_restrictions_subject_active_idx ON public.content_restrictions(subject_type, subject_id, starts_at DESC) WHERE lifted_at IS NULL;
ALTER TABLE public.moderation_decisions ADD CONSTRAINT moderation_decisions_restriction_fkey FOREIGN KEY (linked_restriction_id) REFERENCES public.content_restrictions(id) ON DELETE RESTRICT;
COMMENT ON TABLE public.content_restrictions IS 'Active and historical restrictions over moderated content.';
-- migrate:down
DROP TABLE public.content_restrictions;
