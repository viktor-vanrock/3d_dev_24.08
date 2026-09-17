-- migrate:up

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM (
    'draft', 'uploading', 'reviewing', 'ready', 'published', 'unpublished', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status project_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- ВНИМАНИЕ: выполнить SELECT ниже ВРУЧНУЮ перед применением UPDATE,
-- чтобы увидеть сколько проектов изменит статус.
/*
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE published_revision_id IS NOT NULL) AS currently_published,
  COUNT(*) FILTER (WHERE published_revision_id IS NULL AND deleted_at IS NULL) AS will_become_draft
FROM projects;
*/

UPDATE projects
SET status = CASE
  WHEN deleted_at IS NOT NULL THEN 'archived'::project_status
  WHEN published_revision_id IS NOT NULL THEN 'published'::project_status
  ELSE 'draft'::project_status
END,
published_at = CASE
  WHEN published_revision_id IS NOT NULL THEN coalesce(
    published_at,
    (SELECT created_at FROM project_revisions WHERE id = projects.published_revision_id)
  )
  ELSE published_at
END,
archived_at = CASE WHEN deleted_at IS NOT NULL THEN deleted_at ELSE NULL END;

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects (owner_id, status);

-- migrate:down

ALTER TABLE projects
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS published_at,
  DROP COLUMN IF EXISTS archived_at;

DROP TYPE IF EXISTS project_status;
