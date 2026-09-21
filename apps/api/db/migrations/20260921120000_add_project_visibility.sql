-- migrate:up

DO $$ BEGIN
  CREATE TYPE project_visibility AS ENUM ('private', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility project_visibility
    NOT NULL DEFAULT 'private';

UPDATE projects
SET visibility = CASE
  WHEN published_revision_id IS NOT NULL THEN 'public'::project_visibility
  ELSE 'private'::project_visibility
END;

CREATE INDEX IF NOT EXISTS idx_projects_visibility
  ON projects (visibility);

CREATE INDEX IF NOT EXISTS idx_projects_visibility_status
  ON projects (visibility, status);

-- migrate:down

ALTER TABLE projects DROP COLUMN IF EXISTS visibility;
DROP TYPE IF EXISTS project_visibility;
