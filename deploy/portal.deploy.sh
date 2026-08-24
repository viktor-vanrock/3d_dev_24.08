#!/usr/bin/env bash
# Автодеплой main на VDS: polling origin/main (запускается таймером portal.deploy.timer
# раз в минуту, см. portal.deploy.service/.timer в этом же каталоге). MF-479.
#
# Логика: flock (защита от параллельных запусков) → guard (ветка != main → warn + fix) →
# git fetch → если origin/main не ушёл вперёд, выход → git checkout -f main +
# git reset --hard origin/main → pnpm install --frozen-lockfile && pnpm build →
# если в подтянутом диапазоне коммитов менялся apps/api/ - dbmate migrate, затем
# перезапустить portal.api. При ошибке сборки ИЛИ миграции сервис НЕ перезапускается,
# скрипт выходит с ненулевым кодом (MF-586).
#
# Self-healing (MF-545): заменяет git pull --ff-only на git checkout -f main +
# git reset --hard origin/main — таймер переживает переключение на чужую ветку или
# diverged-состояние без ручного вмешательства.
#
# Alert (MF-545): FAIL_THRESHOLD тиков подряд с ошибкой → уведомление в telegram-мост
# (/home/plag/tg-bridge/queue) + journalctl (systemd-cat).
#
# Правило (MF-545): /home/plag/portal.ru принадлежит ТОЛЬКО этому таймеру.
# Агентские ветки и worktree в этом каталоге запрещены — см. deploy/portal.deploy.rules.md.
#
# Требует passwordless sudo строго на `systemctl restart portal.api` для пользователя plag
# (см. portal.deploy.sudoers в этом каталоге).
#
# Кэш turbo (MF-641): TURBO_CACHE_DIR указывает на физически отдельный от dev-контура
# каталог — prod и dev worktree-копии не должны читать/писать один и тот же кэш,
# даже если инвалидация по хэшу когда-нибудь снова окажется неполной. После сборки —
# guard: если в проде оказался dev-бандл (содержит api.dev.3mf.tech), деплой падает
# ДО перезапуска сервиса, а не выкатывает отравленный dist молча.
#
# VITE_API_URL (MF-726): скрипт НИКОГДА не экспортировал эту переменную для `pnpm build`
# (симметричная находка на dev-скрипте при разборе служебной сессии autofab-agent) —
# turbo.json объявляет её частью кэш-ключа web:build, но при вечно-unset значении все
# автодеплои хешируются одинаково, и рано или поздно кэш отдаёт сборку без API_URL вообще
# (фронт бьёт same-origin, /auth/session падает на SPA-фолбэк index.html — тихий разлогин
# всех, старый guard ниже этого не ловит, он проверяет только отсутствие dev-хоста).
export VITE_API_URL="https://api.3mf.tech"
#
# Защита от самомодификации (MF-586, эмпирически найдено при добавлении шага dbmate):
# скрипт делает git checkout/reset НАД САМИМ СОБОЙ, пока bash его же выполняет — POSIX
# не гарантирует поведение чтения скрипта, который меняется во время исполнения, и на
# практике это ловилось: bash читает файл блоками, git reset подменяет файл другого
# размера, и хвост скрипта после reset тихо не исполнялся (проверено локальным
# репродом). Фикс — обернуть всё тело в `{ ... }`: bash обязан дочитать весь блок до
# закрывающей `}` ДО начала исполнения, поэтому последующая подмена файла на диске
# больше не может свернуть/потерять хвост уже распарсенного тела.
{

set -euo pipefail

REPO_DIR="/home/plag/portal.ru"
LOCK_FILE="/tmp/portal.deploy.lock"
FAIL_COUNT_FILE="/tmp/portal.deploy.fail_count"
FAIL_THRESHOLD=3
BRIDGE_QUEUE="${BRIDGE_QUEUE:-/home/plag/tg-bridge/queue}"
TURBO_CACHE_DIR="/home/plag/.cache/turbo-prod"
export TURBO_CACHE_DIR

_send_alert() {
  local msg="$1"
  systemd-cat -t portal.deploy -p err echo "ALERT: ${msg}" || true
  if [ -d "$BRIDGE_QUEUE" ]; then
    python3 - "$msg" "$BRIDGE_QUEUE" <<'PY' || true
import json, sys, time, os
text, queue = sys.argv[1:3]
fn = os.path.join(queue, f"{int(time.time()*1000)}_portal.deploy.json")
json.dump({"type": "alert", "card": "infra", "text": text, "agent": "portal.deploy"}, open(fn, "w"), ensure_ascii=False)
PY
  fi
}

_on_exit() {
  set +e
  local rc=$?
  if [ $rc -ne 0 ]; then
    local count=1
    if [ -f "$FAIL_COUNT_FILE" ]; then
      local saved
      saved=$(cat "$FAIL_COUNT_FILE" 2>/dev/null) || saved=0
      count=$(( saved + 1 )) || count=1
    fi
    printf '%d\n' "$count" > "$FAIL_COUNT_FILE" || true
    echo "portal.deploy: ОШИБКА — тик ${count} подряд (exit ${rc})" >&2
    systemd-cat -t portal.deploy -p err echo "portal.deploy: ошибка тик ${count} подряд (exit ${rc})" || true
    if [ "$count" -ge "$FAIL_THRESHOLD" ]; then
      _send_alert "portal.deploy: ${count} тиков подряд с ошибкой — деплой заморожен, требуется проверка VDS!"
    fi
  else
    rm -f "$FAIL_COUNT_FILE" || true
  fi
}
trap _on_exit EXIT

exec 200>"$LOCK_FILE"
flock -n 200 || { echo "portal.deploy: другой запуск уже идёт, выходим"; exit 0; }

cd "$REPO_DIR"

# Guard (MF-545): prod-каталог должен быть на ветке main.
# Чужая ветка или detached HEAD = нарушение инварианта → лог + принудительный возврат.
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [ "${CURRENT_BRANCH}" != "main" ]; then
  echo "portal.deploy: WARN — рабочая копия на ветке '${CURRENT_BRANCH:-detached}' вместо main — исправляем" >&2
  systemd-cat -t portal.deploy -p warning echo "portal.deploy: WARN — ветка '${CURRENT_BRANCH:-detached}', возвращаем на main" || true
  git checkout -f main
fi

git fetch origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "portal.deploy: origin/main без изменений, нечего деплоить"
  exit 0
fi

echo "portal.deploy: найдены новые коммиты ${LOCAL_HEAD} -> ${REMOTE_HEAD}"

# Self-heal (MF-545): reset вместо pull --ff-only — переживает diverged-состояние.
git reset --hard origin/main

if ! pnpm install --frozen-lockfile; then
  echo "portal.deploy: pnpm install упал, сборка прервана" >&2
  exit 1
fi

# Чистим dist ПЕРЕД сборкой (MF-641): turbo при cache hit не запускает vite и не
# чистит output-каталог сам (emptyOutDir срабатывает только внутри самого vite build) —
# старые файлы из предыдущей сборки остаются лежать рядом с новыми. Проверено руками:
# без rm -rf в dist/assets накапливаются бандлы от разных сборок одновременно — именно
# такую картину («два бандла, index.html ссылается не на тот») застали в инциденте.
# Безопасно чистить здесь: dist больше не то, что отдаёт nginx (см. MF-734 ниже) —
# nginx root смотрит на dist-live, а не на dist напрямую.
rm -rf apps/web/dist

if ! pnpm build; then
  echo "portal.deploy: pnpm build упал, portal.api НЕ перезапускается" >&2
  exit 1
fi

# Guard от отравления кэша (MF-641): прод-бандл не должен содержать dev-URL API.
# Если содержит — где-то закэширован/переиспользован dev-артефакт, деплой должен
# упасть ДО перезапуска сервиса, а не выкатить чужой бандл на прод.
if grep -rl 'api.dev.3mf.tech' apps/web/dist/assets/*.js >/dev/null 2>&1; then
  echo "portal.deploy: GUARD — в прод-бандле найден api.dev.3mf.tech, деплой остановлен" >&2
  systemd-cat -t portal.deploy -p err echo "portal.deploy: GUARD — прод-бандл содержит api.dev.3mf.tech, отравление кэша" || true
  exit 1
fi

# Симметричный positive-guard (MF-726): прод-бандл ОБЯЗАН содержать свой API-хост.
# Без этого предыдущий guard молча пропускал бандл с пустым VITE_API_URL (same-origin
# fetch на проде тихо ломает /auth/session — не ловилось до сих пор).
if ! grep -rl 'api.3mf.tech' apps/web/dist/assets/*.js >/dev/null 2>&1; then
  echo "portal.deploy: GUARD — в прод-бандле НЕТ api.3mf.tech, деплой остановлен" >&2
  systemd-cat -t portal.deploy -p err echo "portal.deploy: GUARD — прод-бандл без api.3mf.tech, VITE_API_URL не попал в сборку" || true
  exit 1
fi

# Атомарная выкладка (MF-734, симметрично portal.deploy-dev.sh): nginx root на VDS
# смотрит на apps/web/dist-live — симлинк, переключаемый ОДНИМ syscall (rename, через
# `mv -T`) на свежесобранный релиз только ПОСЛЕ успешного build + оба guard'а. Раньше
# `rm -rf apps/web/dist` перед сборкой чистил каталог, который nginx отдаёт напрямую
# как root, — на несколько секунд (пока vite пересобирает файлы) любой запрос к
# 3mf.tech ловил 404. Пойман на dev-контуре (синтетик-монитор), здесь фикс применён
# превентивно — тот же race тут ждал своего инцидента.
RELEASE_ID="$(date +%Y%m%d%H%M%S)-${REMOTE_HEAD:0:8}"
RELEASE_DIR="apps/web/releases/${RELEASE_ID}"
mkdir -p apps/web/releases
rm -rf "$RELEASE_DIR"
mv apps/web/dist "$RELEASE_DIR"
ln -sfn "${REPO_DIR}/${RELEASE_DIR}" apps/web/dist-live.tmp
mv -Tf apps/web/dist-live.tmp apps/web/dist-live
# Держим последние 3 релиза (откат/дебаг), старые чистим.
ls -1dt apps/web/releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

if git diff --name-only "$LOCAL_HEAD" "$REMOTE_HEAD" -- apps/api/ | grep -q .; then
  # Миграция БД (MF-586, MF-836, docs/epics/backend.foundation.md § «Решения CTO / 2»): dbmate,
  # ДО рестарта api — единственный писатель schema_migrations (boot-replay migrate()/SCHEMA_SQL
  # убран из apps/api в MF-836). DATABASE_URL берём из того же EnvironmentFile, что и сам сервис
  # (portal.api.service), не храним отдельно.
  set -a
  # shellcheck disable=SC1091
  source /home/plag/portal.api.env
  set +a
  if ! pnpm --filter @portal/api run db:migrate; then
    echo "portal.deploy: dbmate migrate упал, portal.api НЕ перезапускается" >&2
    exit 1
  fi

  # dbmate up перезаписывает db/schema.sql pg_dump-снапшотом ЭТОЙ машины (версия постгреса/ОС
  # в комментарии дампа отличается от закоммиченной — симметрично portal.deploy-dev.sh, MF-434:
  # расхождение блокирует следующий `git pull --ff-only` "your local changes would be
  # overwritten"). Файл — ревьюируемый снапшот в git, не артефакт этой машины: откатываем к
  # закоммиченной версии, схема уже применена в БД этим же шагом.
  git checkout -- apps/api/db/schema.sql

  echo "portal.deploy: apps/api/ изменился, перезапускаем portal.api"
  sudo systemctl restart portal.api
else
  echo "portal.deploy: apps/api/ не менялся, перезапуск не нужен"
fi

echo "portal.deploy: деплой ${REMOTE_HEAD} завершён"

}
