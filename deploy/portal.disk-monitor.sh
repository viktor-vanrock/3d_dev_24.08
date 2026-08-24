#!/usr/bin/env bash
# Мониторинг свободного места на диске VDS. Запускается таймером portal.disk-monitor.timer.
# Если диск заполнен выше порога — пишет уровень WARNING/CRITICAL в journal (systemd-cat),
# что попадает в journalctl и может быть отловлено любым агрегатором логов.
#
# Пороги: WARNING >= 75%, CRITICAL >= 90%.
#
# Установка на VDS (вместе с portal.backup):
#   sudo cp deploy/portal.disk-monitor.service /etc/systemd/system/
#   sudo cp deploy/portal.disk-monitor.timer /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now portal.disk-monitor.timer
# Проверка: systemctl start portal.disk-monitor.service && journalctl -u portal.disk-monitor -n 20

set -euo pipefail

WARN_THRESHOLD=75
CRIT_THRESHOLD=90
MOUNT="/"

USED_PCT=$(df --output=pcent "${MOUNT}" | tail -1 | tr -d ' %')
FREE_H=$(df -h --output=avail "${MOUNT}" | tail -1 | tr -d ' ')
USED_H=$(df -h --output=used "${MOUNT}" | tail -1 | tr -d ' ')
SIZE_H=$(df -h --output=size "${MOUNT}" | tail -1 | tr -d ' ')

GIT_REPOS_USED="n/a"
if [ -d /srv/git/repos ]; then
    GIT_REPOS_USED=$(du -sh /srv/git/repos 2>/dev/null | cut -f1 || echo "n/a")
fi

BACKUPS_USED="n/a"
if [ -d /srv/backups ]; then
    BACKUPS_USED=$(du -sh /srv/backups 2>/dev/null | cut -f1 || echo "n/a")
fi

MSG="disk ${MOUNT}: ${USED_PCT}% used (${USED_H}/${SIZE_H}, free ${FREE_H}) | git-repos: ${GIT_REPOS_USED} | backups: ${BACKUPS_USED}"

if [ "${USED_PCT}" -ge "${CRIT_THRESHOLD}" ]; then
    echo "CRITICAL: ${MSG}"
    systemd-cat -t portal.disk-monitor -p crit echo "CRITICAL: ${MSG}"
    exit 2
elif [ "${USED_PCT}" -ge "${WARN_THRESHOLD}" ]; then
    echo "WARNING: ${MSG}"
    systemd-cat -t portal.disk-monitor -p warning echo "WARNING: ${MSG}"
    exit 1
else
    echo "OK: ${MSG}"
fi
