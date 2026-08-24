#!/usr/bin/env bash
# Автодеплой dev на VDS: polling origin/dev (запускается таймером portal.deploy-dev.timer
# раз в минуту). MF-541.
#
# Логика: flock (защита от параллельных запусков) -> git fetch -> если origin/dev
# не ушёл вперёд, выход -> git pull --ff-only -> pnpm install --frozen-lockfile && pnpm build ->
# если в подтянутом диапазоне коммитов менялся apps/api/ - dbmate migrate, затем
# перезапустить portal.api-dev; при изменениях apps/relay/ — собрать compiled Nest artifact,
# проверить активные relay-шаблоны и перезапустить отдельный relay process; при изменениях
# apps/giga/ — синхронизировать Python-
# окружение и перезапустить внутренние portal.giga-http + generation worker; при изменениях
# deploy/opencode.runtime.* —
# прогнать deploy/opencode.runtime.rollout.sh (build → canary → health-gate → swap,
# MF-2045). При ошибке сборки, миграции или health-проверки сервис НЕ считается
# доставленным, скрипт выходит с ненулевым кодом (MF-586/MF-1015).
#
# Требует passwordless sudo на `systemctl restart portal.api-dev` и
# `systemctl restart portal.relay-dev.service` для пользователя plag
# (см. portal.deploy.sudoers).
#
# Рабочая копия на VDS: ~/portal.ru-dev (git worktree на ветке dev).
#
# Кэш turbo (MF-641): TURBO_CACHE_DIR указывает на физически отдельный от prod-контура
# каталог — см. симметричный комментарий в portal.deploy.sh. После сборки — guard:
# если dev-бандл НЕ содержит api.dev.3mf.tech (значит закэширован/переиспользован
# прод-вариант), деплой падает, а не выкатывает чужой бандл на dev.
#
# Атомарная выкладка (MF-734): nginx root смотрит на apps/web/dist-live — симлинк,
# который переключается ОДНИМ syscall (rename, через `mv -T`) на свежесобранный релиз
# только ПОСЛЕ успешного build + guard. Раньше `rm -rf apps/web/dist` перед сборкой
# чистил каталог, который nginx отдаёт напрямую как root, — на несколько секунд (пока
# vite пересобирает файлы) любой запрос к dev.3mf.tech ловил 404. Синтетик-монитор
# поймал именно это окно. См. симметричный комментарий и фикс в portal.deploy.sh.
#
# VITE_API_URL (MF-726): скрипт НИКОГДА не экспортировал эту переменную для `pnpm build`
# (найдено при разборе служебной сессии autofab-agent) — turbo.json объявляет её частью
# кэш-ключа web:build, но если она всегда unset, все автодеплои хешируются одинаково и
# turbo рано или поздно отдаёт из кэша сборку без API_URL вообще (same-origin fetch на
# dev.3mf.tech падает на SPA-фолбэк index.html, /auth/session тихо не логинит никого).
# Экспортируем явно, чтобы бандл детерминированно содержал правильный API-хост.
export VITE_API_URL="https://api.dev.3mf.tech"
# Build-time флаг баннера dev-среды (MF-1528): positive-guard ниже не даст
# выкатить сборку, в которую Vite не вшил маркер dev-контуры. Маркер — это
# aria-label баннера ("Тестовая среда разработки"), а не его видимая надпись:
# MF-1771 сменил видимый текст ("DEV-среда" → компактный бейдж "DEV") и молча
# сломал прежний guard на буквальную надпись — a11y-label семантически привязан
# к DevBanner и переживает косметические переделки.
export VITE_DEV_BANNER="1"
#
# Защита от самомодификации (MF-586) — см. симметричный комментарий в portal.deploy.sh:
# скрипт делает git pull над самим собой во время исполнения, эмпирически поймано, что
# без обёртки хвост после pull может тихо не исполниться. `{ ... }` заставляет bash
# дочитать всё тело до исполнения первой команды.
{

set -euo pipefail

# uv (giga-контур, `uv sync` ниже) стоит в ~/.local/bin (astral.sh installer) — systemd не
# грузит login-shell профили, поэтому дефолтный PATH юнита его не видит и giga-контур молча
# уходил в retry-backoff на каждом тике (найдено вживую: "uv: command not found" в
# portal.deploy-dev.service, retry #5+, giga не выкатывался ни разу через автодеплой).
export PATH="$HOME/.local/bin:$PATH"

REPO_DIR="/home/plag/portal.ru-dev"
LOCK_FILE="/tmp/portal.deploy-dev.lock"
TURBO_CACHE_DIR="/home/plag/.cache/turbo-dev"
export TURBO_CACHE_DIR

exec 200>"$LOCK_FILE"
flock -n 200 || { echo "portal.deploy-dev: другой запуск уже идёт, выходим"; exit 0; }

cd "$REPO_DIR"

git fetch origin dev

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/dev)"
STATE_DIR="/home/plag/.local/state/portal-deploy-dev"
mkdir -p "$STATE_DIR"

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "portal.deploy-dev: найдены новые коммиты ${LOCAL_HEAD} -> ${REMOTE_HEAD}"
  git pull --ff-only origin dev
else
  echo "portal.deploy-dev: исходники уже на ${REMOTE_HEAD:0:8}; проверяем незавершённые контуры"
fi

# У каждого контура свой последний успешно выкаченный SHA. Поэтому падение device-agent
# или giga не удерживает web/API, а упавший контур будет повторно проверяться на каждом тике.
surface_needs_deploy() {
  local surface="$1"
  shift
  local marker="$STATE_DIR/${surface}.sha"
  local deployed_sha=""
  [ -f "$marker" ] && deployed_sha="$(cat "$marker")"
  if [ -z "$deployed_sha" ] || ! git cat-file -e "${deployed_sha}^{commit}" 2>/dev/null; then
    return 0
  fi
  ! git diff --quiet "$deployed_sha" "$REMOTE_HEAD" -- "$@"
}

mark_surface_deployed() {
  printf '%s\n' "$REMOTE_HEAD" > "$STATE_DIR/$1.sha"
}

wait_for_health() {
  local url="$1"
  local attempts=30
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}
surface_retry_allowed() {
  local surface="$1"
  local file="$STATE_DIR/${surface}.failure"
  local failed_sha attempts next_epoch failure_reason
  [ -f "$file" ] || return 0
  IFS='|' read -r failed_sha attempts next_epoch failure_reason < "$file" || return 0
  [ "$failed_sha" = "$REMOTE_HEAD" ] || return 0
  if [ "$(date +%s)" -lt "${next_epoch:-0}" ]; then
    echo "portal.deploy-dev: ${surface} ${REMOTE_HEAD:0:8} backoff until $(date -d "@${next_epoch}" --iso-8601=seconds)"
    return 1
  fi
  return 0
}

record_surface_failure() {
  local surface="$1"
  local reason="$2"
  local file="$STATE_DIR/${surface}.failure"
  local failed_sha="" attempts=0 next_epoch=0 prior_reason=""
  if [ -f "$file" ]; then
    IFS='|' read -r failed_sha attempts next_epoch prior_reason < "$file" || true
  fi
  [ "$failed_sha" = "$REMOTE_HEAD" ] || attempts=0
  attempts=$((attempts + 1))
  local delay=60
  local i
  for ((i = 1; i < attempts; i++)); do
    delay=$((delay * 2))
    [ "$delay" -ge 900 ] && { delay=900; break; }
  done
  next_epoch=$(($(date +%s) + delay))
  printf '%s|%s|%s|%s\n' "$REMOTE_HEAD" "$attempts" "$next_epoch" "$reason" > "$file"
  echo "portal.deploy-dev: ${surface} retry #${attempts} deferred ${delay}s (${reason})" >&2
}

clear_surface_failure() {
  rm -f "$STATE_DIR/$1.failure"
}

# The web bundle imports ../../../../version.json in DevBanner/Footer. Release commits
# intentionally touch only version.json + changelog.md, so omitting the root version
# file here leaves nginx serving the previous bundle and badge indefinitely.
WEB_PATHS=(apps/web packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json version.json)
API_PATHS=(apps/api packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json)
DEVICE_PATHS=(apps/device-agent packages/moonraker-adapter packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json)
RELAY_PATHS=(apps/relay packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json)
GIGA_PATHS=(apps/giga)
OPENCODE_PATHS=(deploy/opencode.runtime.dockerfile deploy/opencode.runtime.compose.yml deploy/opencode.runtime.entrypoint.sh deploy/opencode.runtime.config.base.json deploy/opencode.runtime.version deploy/opencode.runtime.rollout.sh)

WEB_NEEDS=0
API_NEEDS=0
DEVICE_NEEDS=0
RELAY_NEEDS=0
GIGA_NEEDS=0
OPENCODE_NEEDS=0
DEFERRED=0
if surface_needs_deploy web "${WEB_PATHS[@]}"; then
  if surface_retry_allowed web; then WEB_NEEDS=1; else DEFERRED=1; fi
fi
if surface_needs_deploy api "${API_PATHS[@]}"; then
  if surface_retry_allowed api; then API_NEEDS=1; else DEFERRED=1; fi
fi
if surface_needs_deploy device-agent "${DEVICE_PATHS[@]}"; then
  if surface_retry_allowed device-agent; then DEVICE_NEEDS=1; else DEFERRED=1; fi
fi
if surface_needs_deploy relay "${RELAY_PATHS[@]}"; then
  if surface_retry_allowed relay; then RELAY_NEEDS=1; else DEFERRED=1; fi
fi
if surface_needs_deploy giga "${GIGA_PATHS[@]}"; then
  if surface_retry_allowed giga; then GIGA_NEEDS=1; else DEFERRED=1; fi
fi
if surface_needs_deploy opencode-runtime "${OPENCODE_PATHS[@]}"; then
  if surface_retry_allowed opencode-runtime; then OPENCODE_NEEDS=1; else DEFERRED=1; fi
fi

if [ "$WEB_NEEDS" -eq 0 ] && [ "$API_NEEDS" -eq 0 ] && [ "$DEVICE_NEEDS" -eq 0 ] && [ "$RELAY_NEEDS" -eq 0 ] && [ "$GIGA_NEEDS" -eq 0 ] && [ "$OPENCODE_NEEDS" -eq 0 ]; then
  if [ "$DEFERRED" -eq 1 ]; then
    echo "portal.deploy-dev: красные контуры ожидают разрешённого retry-события для ${REMOTE_HEAD:0:8}"
  else
    echo "portal.deploy-dev: все контуры уже подтверждены для ${REMOTE_HEAD:0:8}"
  fi
  exit 0
fi

if ! pnpm install --frozen-lockfile; then
  echo "portal.deploy-dev: pnpm install упал, контуры не запускались" >&2
  exit 1
fi

FAILURES=0

if [ "$WEB_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем и выкатываем web"
  rm -rf apps/web/dist
  if pnpm --filter @portal/web... run build \
    && grep -rl 'api.dev.3mf.tech' apps/web/dist/assets/*.js >/dev/null 2>&1 \
    && grep -rl 'Тестовая среда разработки' apps/web/dist/assets/*.js >/dev/null 2>&1; then
    RELEASE_ID="$(date +%Y%m%d%H%M%S)-${REMOTE_HEAD:0:8}"
    RELEASE_DIR="apps/web/releases/${RELEASE_ID}"
    mkdir -p apps/web/releases
    rm -rf "$RELEASE_DIR"
    mv apps/web/dist "$RELEASE_DIR"
    ln -sfn "${REPO_DIR}/${RELEASE_DIR}" apps/web/dist-live.tmp
    mv -Tf apps/web/dist-live.tmp apps/web/dist-live
    ls -1dt apps/web/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
    mark_surface_deployed web
    clear_surface_failure web
    echo "portal.deploy-dev: web ${REMOTE_HEAD:0:8} опубликован"
  else
    echo "portal.deploy-dev: web не опубликован — build или API-URL guard упал" >&2
    record_surface_failure web build_or_guard_failed
    FAILURES=1
  fi
fi

if [ "$API_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем и выкатываем API"
  if pnpm --filter @portal/api... run build; then
    set -a
    # shellcheck disable=SC1091
    source /home/plag/portal.api-dev.env
    set +a
    if pnpm --filter @portal/api run db:migrate; then
      git checkout -- apps/api/db/schema.sql
      sudo systemctl restart portal.api-dev
      mark_surface_deployed api
      clear_surface_failure api
      echo "portal.deploy-dev: API ${REMOTE_HEAD:0:8} опубликован"
    else
      echo "portal.deploy-dev: миграция API упала; прежний API оставлен живым" >&2
      record_surface_failure api migration_failed
      FAILURES=1
    fi
  else
    echo "portal.deploy-dev: API не опубликован — build упал" >&2
    record_surface_failure api build_failed
    FAILURES=1
  fi
fi

if [ "$DEVICE_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем device-agent"
  if pnpm --filter @portal/device-agent... run build; then
    mark_surface_deployed device-agent
    clear_surface_failure device-agent
    echo "portal.deploy-dev: device-agent ${REMOTE_HEAD:0:8} подтверждён"
  else
    echo "portal.deploy-dev: device-agent не подтверждён — build упал" >&2
    record_surface_failure device-agent build_failed
    FAILURES=1
  fi
fi

if [ "$RELAY_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем compiled Nest relay"
  if pnpm run check:relay-deploy \
    && pnpm --filter @portal/relay... run build \
    && sudo systemctl restart portal.relay-dev.service \
    && wait_for_health http://127.0.0.1:3012/ready; then
    mark_surface_deployed relay
    clear_surface_failure relay
    echo "portal.deploy-dev: Nest relay ${REMOTE_HEAD:0:8} опубликован и readiness подтверждён"
  else
    echo "portal.deploy-dev: relay не опубликован — config/build/restart/readiness упал" >&2
    record_surface_failure relay config_build_restart_or_readiness_failed
    FAILURES=1
  fi
fi

if [ "$GIGA_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем и выкатываем giga"
  if (cd apps/giga && uv sync --no-dev) \
    && sudo cp apps/giga/deploy/portal.giga-http.service /etc/systemd/system/portal.giga-http.service \
    && sudo cp apps/giga/deploy/portal.giga-worker.service /etc/systemd/system/portal.giga-worker.service \
    && sudo systemctl daemon-reload \
    && sudo systemctl enable portal.giga-http.service \
    && sudo systemctl enable portal.giga-worker.service \
    && sudo systemctl restart portal.giga-http.service \
    && sudo systemctl restart portal.giga-worker.service \
    && wait_for_health http://127.0.0.1:3102/health \
    && systemctl is-active --quiet portal.giga-worker.service; then
    mark_surface_deployed giga
    clear_surface_failure giga
    echo "portal.deploy-dev: giga ${REMOTE_HEAD:0:8} опубликован и health подтверждён"
  else
    echo "portal.deploy-dev: giga не опубликован — uv sync/restart/health упал" >&2
    record_surface_failure giga sync_restart_or_health_failed
    FAILURES=1
  fi
fi

if [ "$OPENCODE_NEEDS" -eq 1 ]; then
  echo "portal.deploy-dev: проверяем и выкатываем opencode-runtime (MF-2045)"
  if [ -f "$HOME/portal.opencode-runtime.env" ] && deploy/opencode.runtime.rollout.sh deploy; then
    mark_surface_deployed opencode-runtime
    clear_surface_failure opencode-runtime
    echo "portal.deploy-dev: opencode-runtime ${REMOTE_HEAD:0:8} опубликован и health подтверждён"
  elif [ ! -f "$HOME/portal.opencode-runtime.env" ]; then
    echo "portal.deploy-dev: opencode-runtime пропущен — нет ~/portal.opencode-runtime.env (см. deploy/portal.opencode-runtime.env.example), контур ещё не установлен на этом хосте" >&2
    record_surface_failure opencode-runtime env_missing
  else
    echo "portal.deploy-dev: opencode-runtime не опубликован — build/canary/health упал" >&2
    record_surface_failure opencode-runtime rollout_failed
    FAILURES=1
  fi
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "portal.deploy-dev: есть красные контуры; успешные контуры уже выкачены" >&2
  exit 1
fi

echo "portal.deploy-dev: все затронутые контуры ${REMOTE_HEAD:0:8} подтверждены"

}
