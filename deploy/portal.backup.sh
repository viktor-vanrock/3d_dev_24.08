#!/usr/bin/env bash
# Бэкап прод-данных portal.ru: Postgres (portal), git bare-репозитории (/srv/git/repos/),
# env-файлы. Запускается ежесуточно таймером portal.backup.timer.
#
# Бэкапы хранятся в /srv/backups/ (владелец plag:plag 750), ротация — последние 14 дней.
# При запуске вне VDS (нет /srv/backups) скрипт завершится с ошибкой.
#
# Env-файлы шифруются симметрично GPG (AES256) ключом-паролем из BACKUP_KEY_FILE —
# это отдельный секрет на VDS, НЕ в git (см. SECURITY.md). Расшифровка — portal.restore-env.sh.
#
# Установка на VDS:
#   sudo cp deploy/portal.backup.service /etc/systemd/system/
#   sudo cp deploy/portal.backup.timer /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now portal.backup.timer
# Ручной тест: systemctl start portal.backup.service && journalctl -u portal.backup -f

set -euo pipefail

BACKUP_DIR="/srv/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="portal_${TIMESTAMP}"
WORK_DIR="${BACKUP_DIR}/${BACKUP_NAME}"
RETENTION_DAYS=14
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/home/plag/.portal-backup.key}"

if [ ! -s "${BACKUP_KEY_FILE}" ]; then
    echo "portal.backup: ОШИБКА — не найден ключ шифрования ${BACKUP_KEY_FILE}." >&2
    echo "portal.backup: создай один раз: (umask 077; openssl rand -base64 48 > ${BACKUP_KEY_FILE})" >&2
    exit 1
fi

mkdir -p "${WORK_DIR}"

echo "portal.backup: старт ${TIMESTAMP}"

# 1. Postgres: база portal (TCP, ~/.pgpass)
# Порт 5434 — нативный прод-Postgres на VDS; 5432 занят Docker dev-compose стеком
# (portalru-postgres-1, БД portal_dev) — см. docs/infra/readme.md.
echo "portal.backup: pg_dump portal..."
pg_dump -h localhost -p 5434 -U portal -Fc portal > "${WORK_DIR}/postgres_portal.dump"
echo "portal.backup: pg_dump portal OK ($(du -sh "${WORK_DIR}/postgres_portal.dump" | cut -f1))"

# 2. Git bare-репозитории
echo "portal.backup: git repos /srv/git/repos/..."
tar -czf "${WORK_DIR}/git_repos.tar.gz" -C /srv/git repos/
echo "portal.backup: git repos OK ($(du -sh "${WORK_DIR}/git_repos.tar.gz" | cut -f1))"

# 3. Env-файлы (портал + меш) — реальное симметричное шифрование GPG/AES256
echo "portal.backup: env files (gpg AES256)..."
gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_KEY_FILE}" \
    --symmetric --cipher-algo AES256 \
    -o "${WORK_DIR}/portal.api.env.gpg" /home/plag/portal.api.env
gpg --batch --yes --pinentry-mode loopback --passphrase-file "${BACKUP_KEY_FILE}" \
    --symmetric --cipher-algo AES256 \
    -o "${WORK_DIR}/portal.mesh.env.gpg" /home/plag/portal.mesh.env
chmod 600 "${WORK_DIR}/portal.api.env.gpg" "${WORK_DIR}/portal.mesh.env.gpg"
echo "portal.backup: env OK (зашифровано, ключ ${BACKUP_KEY_FILE})"

# 4. Итоговый архив
echo "portal.backup: архивирую ${BACKUP_NAME}..."
tar -czf "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" -C "${BACKUP_DIR}" "${BACKUP_NAME}/"
rm -rf "${WORK_DIR}"
chmod 600 "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
echo "portal.backup: архив $(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)"

# 5. Ротация: удаляем архивы старше RETENTION_DAYS
echo "portal.backup: ротация (>${RETENTION_DAYS} дней)..."
find "${BACKUP_DIR}" -maxdepth 1 -name "portal_*.tar.gz" \
    -mtime "+${RETENTION_DAYS}" -delete -print | while read -r f; do
    echo "portal.backup: удалён устаревший ${f}"
done

echo "portal.backup: готово — ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
echo "portal.backup: свободно на диске: $(df -h /srv | awk 'NR==2{print $4}') ($(df -h /srv | awk 'NR==2{print $5}') занято)"
