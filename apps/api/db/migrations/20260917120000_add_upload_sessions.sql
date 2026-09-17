-- migrate:up

CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  object_key TEXT,
  final_key TEXT,
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  checksum_sha256 BYTEA,
  error_code TEXT,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT upload_sessions_role_check CHECK (role IN ('source', 'preview', 'photo', 'media', 'avatar')),
  CONSTRAINT upload_sessions_status_check CHECK (status IN ('pending', 'validating', 'ready', 'failed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner ON upload_sessions (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expire ON upload_sessions (expires_at)
  WHERE status IN ('pending', 'validating');

-- migrate:down

DROP TABLE IF EXISTS upload_sessions;
