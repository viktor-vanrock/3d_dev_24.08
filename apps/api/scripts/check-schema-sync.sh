#!/usr/bin/env bash
# CI-гейт (MF-836): прогоняет `dbmate up` на пустой БД (DATABASE_URL из окружения — CI-сервис
# postgres или `sandbox-db create` локально) и проверяет, что результат воспроизводит
# закоммиченный db/schema.sql 1:1. Непустой diff = в снапшоте есть версия schema_migrations
# без реально применённого DDL (ровно тот класс инцидентов — MF-33/409, MF-466, MF-748) —
# кто-то отредактировал файл миграции после того, как её версия уже засветилась в
# schema_migrations на общей БД, либо schema.sql правили руками.
#
# Игнорируем строки "-- Dumped ... version" — там версия/сборка postgres/pg_dump той машины,
# что делала дамп, и она дрейфует независимо от схемы (симметрично deploy/portal.deploy.sh,
# который по той же причине откатывает schema.sql к закоммиченной версии после dbmate up).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL не задан — укажи пустую БД (CI-сервис postgres или sandbox-db create)}"

BEFORE="$(mktemp)"
cp db/schema.sql "$BEFORE"

pnpm --filter @portal/api run db:migrate

if diff -u <(grep -v '^-- Dumped ' "$BEFORE") <(grep -v '^-- Dumped ' db/schema.sql); then
  echo "check-schema-sync: dbmate up на пустой БД воспроизводит db/schema.sql 1:1"
  rc=0
else
  echo "check-schema-sync: diff непустой — db/schema.sql не соответствует реальному прогону миграций (см. заголовок скрипта)" >&2
  rc=1
fi

cp "$BEFORE" db/schema.sql
rm -f "$BEFORE"
exit $rc
