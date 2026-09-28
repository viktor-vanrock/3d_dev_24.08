-- migrate:up
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_text text,
  ADD COLUMN IF NOT EXISTS subject_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS priority integer,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.reports
SET reason_code = 'other', reason_text = reason,
    subject_snapshot = jsonb_build_object('schema_version', 1, 'legacy', true),
    priority = 20, due_at = created_at + interval '72 hours', updated_at = created_at
WHERE reason_code IS NULL;

ALTER TABLE public.reports
  ALTER COLUMN reason_code SET NOT NULL, ALTER COLUMN reason_code SET DEFAULT 'other',
  ALTER COLUMN subject_snapshot SET NOT NULL, ALTER COLUMN subject_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN priority SET NOT NULL, ALTER COLUMN priority SET DEFAULT 20,
  ALTER COLUMN due_at SET NOT NULL, ALTER COLUMN due_at SET DEFAULT (now() + interval '72 hours'),
  ALTER COLUMN updated_at SET NOT NULL, ALTER COLUMN updated_at SET DEFAULT now(),
  DROP CONSTRAINT IF EXISTS reports_subject_type_check,
  DROP CONSTRAINT IF EXISTS reports_subject_type_subject_id_reporter_id_key,
  DROP CONSTRAINT IF EXISTS reports_status_check,
  DROP CONSTRAINT IF EXISTS reports_decision_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_subject_type_check CHECK (subject_type IN ('make', 'model', 'post', 'thread', 'comment')),
  ADD CONSTRAINT reports_status_check CHECK (status IN ('open', 'assigned', 'resolved', 'dismissed', 'withdrawn')),
  ADD CONSTRAINT reports_reason_code_check CHECK (reason_code IN ('illegal', 'copyright', 'spam', 'harassment', 'abuse', 'other')),
  ADD CONSTRAINT reports_reason_text_length_check CHECK (reason_text IS NULL OR char_length(reason_text) <= 2000),
  ADD CONSTRAINT reports_snapshot_object_check CHECK (jsonb_typeof(subject_snapshot) = 'object'),
  ADD CONSTRAINT reports_priority_nonnegative_check CHECK (priority >= 0),
  ADD CONSTRAINT reports_decision_check CHECK (decision IN ('accepted', 'rejected') OR decision IS NULL);

CREATE UNIQUE INDEX reports_one_open_per_reporter_idx ON public.reports(subject_type, subject_id, reporter_id) WHERE status IN ('open', 'assigned');
CREATE UNIQUE INDEX reports_idempotency_key_idx ON public.reports(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX reports_moderation_queue_idx ON public.reports(status, priority DESC, due_at ASC, created_at ASC) WHERE status IN ('open', 'assigned');
CREATE INDEX reports_subject_history_idx ON public.reports(subject_type, subject_id, created_at DESC);
COMMENT ON TABLE public.reports IS 'Unified moderation flags. Legacy make/model reports retained and extended.';
-- migrate:down
-- Irreversible data migration.
