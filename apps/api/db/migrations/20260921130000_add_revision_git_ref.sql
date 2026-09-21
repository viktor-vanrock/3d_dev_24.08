-- migrate:up

ALTER TABLE project_revisions
  ADD COLUMN IF NOT EXISTS git_ref TEXT NULL;

-- migrate:down

ALTER TABLE project_revisions
  DROP COLUMN IF EXISTS git_ref;
