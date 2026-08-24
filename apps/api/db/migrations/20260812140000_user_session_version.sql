-- migrate:up
ALTER TABLE users
  ADD COLUMN session_version integer NOT NULL DEFAULT 1;

-- migrate:down
ALTER TABLE users DROP COLUMN session_version;
