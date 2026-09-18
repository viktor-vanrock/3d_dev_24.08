-- migrate:up

ALTER TABLE device_transfers
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    DEFAULT (now() + interval '24 hours');

CREATE INDEX IF NOT EXISTS idx_device_transfers_expires
  ON device_transfers (expires_at)
  WHERE status IN ('initiated', 'transferring');

-- migrate:down

DROP INDEX IF EXISTS idx_device_transfers_expires;

ALTER TABLE device_transfers DROP COLUMN IF EXISTS expires_at;
