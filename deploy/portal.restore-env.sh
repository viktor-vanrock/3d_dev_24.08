#!/usr/bin/env bash
# Расшифровка env-файлов из бэкапа portal.ru (см. portal.backup.sh).
# Пара к шифрованию: gpg --symmetric --cipher-algo AES256, ключ — BACKUP_KEY_FILE.
#
# Использование:
#   deploy/portal.restore-env.sh <входной .gpg> <выходной путь>
#
# Пример (после распаковки portal_YYYYMMDD_HHMMSS.tar.gz):
#   deploy/portal.restore-env.sh portal_20260709_030444/portal.api.env.gpg /tmp/portal.api.env.restored

set -euo pipefail

BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/home/plag/.portal-backup.key}"

if [ "$#" -ne 2 ]; then
    echo "Использование: $0 <входной .gpg> <выходной путь>" >&2
    exit 1
fi

INPUT="$1"
OUTPUT="$2"

if [ ! -s "${BACKUP_KEY_FILE}" ]; then
    echo "portal.restore-env: ОШИБКА — не найден ключ шифрования ${BACKUP_KEY_FILE}." >&2
    exit 1
fi

if [ ! -s "${INPUT}" ]; then
    echo "portal.restore-env: ОШИБКА — входной файл ${INPUT} не найден." >&2
    exit 1
fi

gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_KEY_FILE}" \
    --decrypt -o "${OUTPUT}" "${INPUT}"
chmod 600 "${OUTPUT}"

echo "portal.restore-env: расшифровано → ${OUTPUT}"
