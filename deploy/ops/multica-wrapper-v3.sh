#!/usr/bin/env bash
# Обёртка над multica (реальный бинарь → multica.real). Агентский mat_-токен (инжектит
# демон) НЕ может менять assignee: сервер режет права (403), а сам бинарь в agent-контексте
# требует именно mat_ и отвергает операторский токен. Но эстафета сквада держится на assign
# (только назначение будит агента) — оператор осознанно разрешает это на self-hosted.
#
# v3 (2026-07-09): бинарь 0.3.40 детектит agent-контекст не только по MULTICA_TASK_ID, но и
# по MULTICA_DAEMON_PORT / MULTICA_SERVER_URL / MULTICA_WORKSPACE_ID (репро подтверждён).
# Поэтому теперь снимаем ВСЕ MULTICA_* (future-proof), кроме токена — его ставим операторский.
# Плюс элевейт не только на assign/rerun/cancel-task, а на ЛЮБОЙ флаг назначения
# (--assignee/--assignee-id/--to/--to-id) — т.к. агенты зовут и `issue update --assignee`.
# Всё прочее (create/comment/status без назначения) идёт БЕЗ подмены — от имени агента.
REAL="/usr/local/bin/multica.real"

elevate=0
if [[ "${1:-}" == "issue" ]]; then
  case "${2:-}" in
    assign|rerun|cancel-task) elevate=1 ;;
  esac
  for arg in "$@"; do
    case "$arg" in
      --assignee|--assignee-id|--to|--to-id|--assignee=*|--assignee-id=*|--to=*|--to-id=*) elevate=1 ;;
    esac
  done
fi

if [[ "$elevate" == "1" ]]; then
  OP_TOKEN="$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.multica/config.json")))["token"])' 2>/dev/null || true)"
  if [[ -n "$OP_TOKEN" ]]; then
    # снять ВЕСЬ agent/daemon-контекст (все MULTICA_* кроме токена), подставить операторский
    unsets="$(env | grep -oE '^MULTICA_[A-Z0-9_]+' | grep -vx 'MULTICA_TOKEN' | sed 's/^/-u /' | tr '\n' ' ')"
    exec env $unsets MULTICA_TOKEN="$OP_TOKEN" "$REAL" "$@"
  fi
fi
exec "$REAL" "$@"
