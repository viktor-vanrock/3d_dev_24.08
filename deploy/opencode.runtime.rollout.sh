#!/usr/bin/env bash
# Rollout изолированного OpenCode runtime (MF-2045): pin-версия →
# build → canary (отдельный контейнер, отдельный порт) → health-gate →
# swap на portal.opencode-runtime.service → rollback одной командой.
#
# Не полноценный traffic-weighted canary (нет живого потребителя/трафика —
# MF-2046 ещё не существует, см. docs/infra/opencode.assistant.runtime.md) —
# честный version-gated canary: новая версия должна ответить health ДО того,
# как заменит текущую, а не после. Ручной `docker compose up`/`systemctl
# restart` в обход этого скрипта не даёт такой гарантии.
#
# Использование:
#   deploy/opencode.runtime.rollout.sh deploy [VERSION]   # по умолчанию — deploy/opencode.runtime.version
#   deploy/opencode.runtime.rollout.sh rollback           # вернуть предыдущую версию из state-файла
#   deploy/opencode.runtime.rollout.sh status
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/deploy/opencode.runtime.compose.yml"
ENV_FILE="${OPENCODE_RUNTIME_ENV_FILE:-$HOME/portal.opencode-runtime.env}"
STATE_FILE="${OPENCODE_RUNTIME_STATE_FILE:-$HOME/.portal.opencode-runtime.rollout.state}"
UNIT="portal.opencode-runtime.service"
CANARY_NAME="portal-opencode-runtime-canary"
CANARY_PORT="${OPENCODE_RUNTIME_CANARY_PORT:-3105}"
HEALTH_TIMEOUT_SECONDS="${OPENCODE_RUNTIME_HEALTH_TIMEOUT_SECONDS:-60}"

log() { echo "opencode.runtime.rollout: $*"; }
die() { echo "opencode.runtime.rollout: ОШИБКА: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || die "нет $ENV_FILE (см. deploy/portal.opencode-runtime.env.example)"
# shellcheck disable=SC1090 — доверенный локальный env-файл (chmod 600), нужен здесь
# же (не только в start_canary) — wait_health ходит с basic auth хостовым curl.
set -a; source "$ENV_FILE"; set +a

pinned_version() {
  tr -d '[:space:]' < "$REPO_DIR/deploy/opencode.runtime.version"
}

wait_health() {
  local port="$1" deadline
  deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -sf -m 3 -u "opencode:${OPENCODE_SERVER_PASSWORD:-}" "http://127.0.0.1:${port}/doc" > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

build_image() {
  local version="$1"
  log "сборка образа portal.opencode.runtime:${version}"
  docker build \
    -f "$REPO_DIR/deploy/opencode.runtime.dockerfile" \
    --build-arg "OPENCODE_VERSION=${version}" \
    -t "portal.opencode.runtime:${version}" \
    "$REPO_DIR"
}

start_canary() {
  local version="$1"
  docker rm -f "$CANARY_NAME" > /dev/null 2>&1 || true
  docker run -d --name "$CANARY_NAME" \
    -p "127.0.0.1:${CANARY_PORT}:4096" \
    -e "HYPERPC_STRUCTURED_URL=${HYPERPC_STRUCTURED_URL:-}" \
    -e "HYPERPC_FAST_URL=${HYPERPC_FAST_URL:-}" \
    -e "OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD:-}" \
    --memory 768m --cpus 1.0 \
    "portal.opencode.runtime:${version}" > /dev/null
}

stop_canary() {
  docker rm -f "$CANARY_NAME" > /dev/null 2>&1 || true
}

cmd_deploy() {
  local version="${1:-$(pinned_version)}"
  local previous=""
  [ -f "$STATE_FILE" ] && previous="$(grep '^current=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || true)"

  build_image "$version"

  log "канарейка на 127.0.0.1:${CANARY_PORT} (версия ${version})"
  start_canary "$version"
  if ! wait_health "$CANARY_PORT"; then
    log "канарейка не ответила /doc за ${HEALTH_TIMEOUT_SECONDS}с — откатываю канарейку, прод НЕ трогаю"
    stop_canary
    die "health-gate провален для версии ${version}, текущая версия (${previous:-неизвестна}) не тронута"
  fi
  log "канарейка здорова, останавливаю"
  stop_canary

  log "переключаю ${UNIT} на версию ${version}"
  sed -i.bak -E "s/^OPENCODE_RUNTIME_VERSION=.*/OPENCODE_RUNTIME_VERSION=${version}/" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  sudo systemctl restart "$UNIT"

  local primary_port
  primary_port="$(grep '^OPENCODE_RUNTIME_PORT=' "$ENV_FILE" | cut -d= -f2)"
  primary_port="${primary_port:-3104}"
  if ! wait_health "$primary_port"; then
    die "версия ${version} не ответила health на проде (порт ${primary_port}) после restart — расследовать journalctl -u ${UNIT}, предыдущая версия была ${previous:-неизвестна}"
  fi

  {
    echo "previous=${previous}"
    echo "current=${version}"
  } > "$STATE_FILE"
  log "готово: ${version} живая на 127.0.0.1:${primary_port}, предыдущая (${previous:-нет}) сохранена для rollback"
}

cmd_rollback() {
  [ -f "$STATE_FILE" ] || die "нет $STATE_FILE — не к чему откатываться"
  local previous
  previous="$(grep '^previous=' "$STATE_FILE" | cut -d= -f2)"
  [ -n "$previous" ] || die "предыдущая версия неизвестна (пустой previous в $STATE_FILE)"
  docker image inspect "portal.opencode.runtime:${previous}" > /dev/null 2>&1 \
    || die "образ portal.opencode.runtime:${previous} не найден локально — пересобрать вручную нельзя откатиться вслепую"
  log "откат на ${previous} (без ребилда, образ уже есть локально)"
  sed -i.bak -E "s/^OPENCODE_RUNTIME_VERSION=.*/OPENCODE_RUNTIME_VERSION=${previous}/" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  sudo systemctl restart "$UNIT"
  local primary_port
  primary_port="$(grep '^OPENCODE_RUNTIME_PORT=' "$ENV_FILE" | cut -d= -f2)"
  primary_port="${primary_port:-3104}"
  wait_health "$primary_port" || die "${previous} тоже не ответил health после rollback — эскалировать оператору немедленно"
  echo "current=${previous}" > "$STATE_FILE"
  log "откат на ${previous} подтверждён живым /doc"
}

cmd_status() {
  systemctl is-active "$UNIT" || true
  [ -f "$STATE_FILE" ] && cat "$STATE_FILE"
  local primary_port
  primary_port="$(grep '^OPENCODE_RUNTIME_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
  primary_port="${primary_port:-3104}"
  curl -sf -m 3 -u "opencode:${OPENCODE_SERVER_PASSWORD:-}" "http://127.0.0.1:${primary_port}/doc" > /dev/null 2>&1 \
    && log "health: OK (127.0.0.1:${primary_port}/doc)" \
    || log "health: НЕ отвечает (127.0.0.1:${primary_port}/doc)"
}

case "${1:-}" in
  deploy) shift; cmd_deploy "${1:-}" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  *) die "использование: $0 {deploy [VERSION]|rollback|status}" ;;
esac
