-- migrate:up
CREATE TABLE public.flag_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flag_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  url text NOT NULL, storage_key text, uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT flag_evidence_url_nonempty_check CHECK (btrim(url) <> '')
);
CREATE INDEX flag_evidence_flag_idx ON public.flag_evidence(flag_id, uploaded_at ASC);
COMMENT ON TABLE public.flag_evidence IS 'Immutable evidence links for moderation flags.';
-- migrate:down
DROP TABLE public.flag_evidence;
