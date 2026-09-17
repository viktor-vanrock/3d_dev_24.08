-- migrate:up

ALTER TABLE public.materials
  ADD COLUMN status text NOT NULL DEFAULT 'published',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN archived_at timestamptz,
  ADD CONSTRAINT materials_status_check CHECK (status IN ('draft', 'published', 'archived')),
  ADD CONSTRAINT materials_version_check CHECK (version > 0),
  ADD CONSTRAINT materials_archived_at_check CHECK ((status = 'archived') = (archived_at IS NOT NULL));

CREATE INDEX materials_admin_updated_idx ON public.materials (status, updated_at DESC, id);

-- migrate:down

DROP INDEX public.materials_admin_updated_idx;
ALTER TABLE public.materials
  DROP CONSTRAINT materials_archived_at_check,
  DROP CONSTRAINT materials_version_check,
  DROP CONSTRAINT materials_status_check,
  DROP COLUMN archived_at,
  DROP COLUMN version,
  DROP COLUMN status;
