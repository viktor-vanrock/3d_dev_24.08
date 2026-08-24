#!/usr/bin/env bash
# Greenfield delivery gate: the single Project API v1 baseline must install on an empty database
# and an immediate replay must be a no-op. DATABASE_URL must point at a disposable empty target.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL не задан — укажи пустую disposable БД}"

pnpm run db:migrate

REPLAY_LOG="$(mktemp)"
cleanup() { rm -f "${REPLAY_LOG}"; }
trap cleanup EXIT

pnpm run db:migrate >"${REPLAY_LOG}" 2>&1
cat "${REPLAY_LOG}"

if grep -q '^Applying:' "${REPLAY_LOG}"; then
  echo "check-migrate-replay-gate: повторный запуск применил миграцию" >&2
  exit 1
fi

echo "check-migrate-replay-gate: Project API v1 baseline установлен, replay является no-op"
