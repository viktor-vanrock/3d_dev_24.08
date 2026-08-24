#!/usr/bin/env bash
# CI-гейт (MF-836, часть класса «applied без DDL»): реджект дублей numeric timestamp-префикса
# в db/migrations/*.sql. Именно эта коллизия (compat_material_flags vs marketplace, 0ab5f69)
# дважды роняла миграцию мимо прода — dbmate сортирует/применяет строго по префиксу, и второй
# файл с уже занятым префиксом либо не запускается, либо путается местами с первым.
set -euo pipefail
cd "$(dirname "$0")/.."

DUPES="$(ls db/migrations | sed -E 's/^([0-9]+)_.*\.sql$/\1/' | sort | uniq -d || true)"

if [ -n "$DUPES" ]; then
  echo "check-migrations-dup: дубль timestamp-префикса в db/migrations/ —" >&2
  while read -r ts; do
    [ -z "$ts" ] && continue
    ls db/migrations/"${ts}"_*.sql >&2
  done <<<"$DUPES"
  exit 1
fi

echo "check-migrations-dup: дублей timestamp-префикса нет"
