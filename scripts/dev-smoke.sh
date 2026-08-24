#!/usr/bin/env bash
# Смоук dev-среды dev.3mf.tech (эпик MF-532, Stage 2 — приёмка п.2/3, «URL + вход + каталог + /project»).
# Прогоняет сквозной сценарий против живого dev-инстанса: health → dev-вход → сессия →
# каталог → SPA-фолбэк на /project. Любой шаг упал → скрипт выходит с ненулевым кодом.
#
# Вход (шаг 2) — служебная cookie portal_session из $SESSION_FILE (см. docs/infra/dev.md
# § «Как зайти»), не POST /auth/dev: этот путь выключен на живом VDS после директивы закрытой
# разработки (MF-1032) и отдаёт 404.
#
# Использование:
#   scripts/dev-smoke.sh
#   API_BASE=http://127.0.0.1:3100 WEB_BASE=http://127.0.0.1:5173 scripts/dev-smoke.sh
#
# Переменные окружения (все с дефолтами под dev-стенд):
#   API_BASE     — базовый URL api      (по умолчанию https://api.dev.3mf.tech)
#   WEB_BASE     — базовый URL web      (по умолчанию https://dev.3mf.tech)
#   SESSION_FILE — файл со служебной dev-сессией (по умолчанию ~/.autofab-session-dev)
set -euo pipefail

API_BASE="${API_BASE:-https://api.dev.3mf.tech}"
WEB_BASE="${WEB_BASE:-https://dev.3mf.tech}"
RELAY_BASE="${RELAY_BASE:-}"
SESSION_FILE="${SESSION_FILE:-$HOME/.autofab-session-dev}"

pass=0
fail=0
ok() { printf '  \033[32mOK\033[0m  %s\n' "$1"; pass=$((pass + 1)); }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail + 1)); }

echo "dev-smoke: API_BASE=$API_BASE  WEB_BASE=$WEB_BASE"

# 1) health api
status="$(curl -fsS -o /dev/null -w '%{http_code}' "$API_BASE/health" 2>/dev/null || echo 000)"
if [ "$status" = "200" ]; then ok "GET $API_BASE/health → 200"; else ko "GET $API_BASE/health → $status (ждали 200)"; fi

# 2) dev-вход: служебная cookie portal_session из $SESSION_FILE (см. docs/infra/dev.md § «Как зайти»).
# POST /auth/dev выключен на живом VDS после директивы закрытой разработки (MF-1032) — отдаёт 404.
if [ -s "$SESSION_FILE" ]; then
  TOKEN="$(cat "$SESSION_FILE")"
  ok "служебная dev-сессия прочитана из $SESSION_FILE"
else
  TOKEN=""
  ko "$SESSION_FILE не найден или пуст (нет служебной cookie; см. docs/infra/dev.md § «Как зайти»)"
fi
COOKIE_HEADER="portal_session=$TOKEN"

# 3) сессия жива: /auth/session с cookie отдаёт autofab-agent
session_json="$(curl -sS -H "Cookie: $COOKIE_HEADER" "$API_BASE/auth/session" 2>/dev/null || echo '{}')"
if printf '%s' "$session_json" | grep -q '"username":"autofab-agent"'; then
  ok "GET $API_BASE/auth/session → autofab-agent"
else
  ko "GET $API_BASE/auth/session не вернул autofab-agent: $session_json"
fi

# 4) каталог доступен с сессией
models="$(curl -sS -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE_HEADER" "$API_BASE/models" 2>/dev/null || echo 000)"
if [ "$models" = "200" ]; then ok "GET $API_BASE/models → 200"; else ko "GET $API_BASE/models → $models (ждали 200)"; fi

# 5) SPA-фолбэк: /project прямым заходом отдаёт index.html (200 + HTML), а не 404
project="$(curl -sS -w '\n%{http_code}' "$WEB_BASE/project" 2>/dev/null || echo $'\n000')"
project_code="$(printf '%s' "$project" | tail -n1)"
project_body="$(printf '%s' "$project" | sed '$d')"
if [ "$project_code" = "200" ] && printf '%s' "$project_body" | grep -qi '<div id="app"'; then
  ok "GET $WEB_BASE/project → 200 + SPA index.html"
else
  ko "GET $WEB_BASE/project → $project_code (ждали 200 + index.html; проверьте try_files … /index.html в nginx)"
fi

# 6) relay observability gate (optional for API-only dev; enabled by RELAY_BASE).
# Проверяет только публичные machine-readable endpoints — в smoke не попадают токены,
# payload команд и диагностический bundle.
if [ -n "$RELAY_BASE" ]; then
  relay_health="$(curl -sS -o /dev/null -w '%{http_code}' "$RELAY_BASE/health" 2>/dev/null || echo 000)"
  if [ "$relay_health" = "200" ]; then ok "GET $RELAY_BASE/health → 200"; else ko "GET $RELAY_BASE/health → $relay_health (ждали 200)"; fi

  relay_metrics="$(curl -fsS "$RELAY_BASE/metrics" 2>/dev/null || true)"
  if printf '%s' "$relay_metrics" | grep -q '^relay_\(active_connections\|auth_failures_total\|heartbeat_errors_total\) '; then
    ok "GET $RELAY_BASE/metrics → relay latency/error counters"
  else
    ko "GET $RELAY_BASE/metrics → отсутствуют обязательные relay counters"
  fi
fi

echo "---"
echo "dev-smoke: $pass ok, $fail fail"
[ "$fail" -eq 0 ]
