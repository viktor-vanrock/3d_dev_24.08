-- migrate:up

-- Hash mirrors canonicalizeIdempotencyPayload(): userId, type, reasonCode, endsAt separated by NUL bytes.
-- PostgreSQL text cannot contain NUL, so concatenate the canonical payload directly as bytea.
WITH legacy_targets AS (
  SELECT id AS user_id, coalesce(updated_at, now()) AS starts_at
  FROM users
  WHERE status = 'banned'
), inserted AS (
  INSERT INTO sanctions (
    id, user_id, type, state, reason_code, reason_note, evidence_url,
    starts_at, ends_at, created_by, idempotency_key, idempotency_payload_hash,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(),
    lt.user_id,
    'ban',
    'active',
    'legacy',
    'Migrated from legacy users.status=banned',
    NULL,
    lt.starts_at,
    NULL,
    '00000000-0000-0000-0000-000000000001',
    'legacy-ban:' || lt.user_id::text,
    digest(
      convert_to(lt.user_id::text, 'UTF8') ||
      decode('00', 'hex') ||
      convert_to('ban', 'UTF8') ||
      decode('00', 'hex') ||
      convert_to('legacy', 'UTF8') ||
      decode('00', 'hex'),
      'sha256'
    ),
    now(),
    now()
  FROM legacy_targets lt
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING user_id
)
UPDATE users
SET status = 'restricted', updated_at = now()
WHERE status = 'banned'
  AND (
    id IN (SELECT user_id FROM inserted)
    OR EXISTS (
      SELECT 1 FROM sanctions s
      WHERE s.user_id = users.id
        AND s.idempotency_key = 'legacy-ban:' || users.id::text
        AND s.reason_code = 'legacy'
        AND s.state = 'active'
    )
  );

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'restricted', 'deleted'));

-- migrate:down

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sanctions WHERE reason_code <> 'legacy' AND state = 'active') THEN
    RAISE EXCEPTION 'cannot roll back cutover: non-legacy active sanctions exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users u
    WHERE u.status = 'restricted'
      AND NOT EXISTS (
        SELECT 1 FROM sanctions s
        WHERE s.user_id = u.id AND s.reason_code = 'legacy' AND s.state = 'active'
      )
  ) THEN
    RAISE EXCEPTION 'cannot roll back cutover: restricted users outside legacy migration exist';
  END IF;
END
$$;

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'restricted', 'banned', 'deleted'));

UPDATE users
SET status = 'banned', updated_at = now()
WHERE id IN (
  SELECT user_id FROM sanctions WHERE reason_code = 'legacy' AND state = 'active'
);

DELETE FROM sanction_appeals
WHERE sanction_id IN (SELECT id FROM sanctions WHERE reason_code = 'legacy');

DELETE FROM sanctions WHERE reason_code = 'legacy';
