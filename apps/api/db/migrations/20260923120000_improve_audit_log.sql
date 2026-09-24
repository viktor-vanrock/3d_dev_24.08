-- migrate:up
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS before_state JSONB,
  ADD COLUMN IF NOT EXISTS after_state JSONB,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS causation_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_idempotency_key_idx ON audit_log(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_correlation_id_idx ON audit_log(correlation_id) WHERE correlation_id IS NOT NULL;

-- migrate:down
ALTER TABLE audit_log
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS actor_type,
  DROP COLUMN IF EXISTS before_state,
  DROP COLUMN IF EXISTS after_state,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS causation_id,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS legal_hold;
