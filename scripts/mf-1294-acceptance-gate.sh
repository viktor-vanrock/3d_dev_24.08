#!/usr/bin/env bash
# Приёмочный gate MF-1345 для первой волны MF-1294.
# Скрипт только читает Git, evidence и deployment markers; production и устройства
# не трогает. Ненулевой код означает, что карточку нельзя передавать в done.
set -euo pipefail

ISSUE_KEY="${ISSUE_KEY:-MF-1345}"
COMMIT="HEAD"
MARKER_DIR="${DEPLOY_MARKER_DIR:-/home/plag/.local/state/portal-deploy-dev}"
EVIDENCE=""

usage() {
  cat <<'EOF'
Использование: scripts/mf-1294-acceptance-gate.sh [параметры]

  --commit SHA       проверяемый commit (по умолчанию HEAD)
  --marker-dir DIR   каталог маркеров portal-deploy-dev
  --evidence FILE    файл evidence первой волны; требуется для recovery-gate
EOF
}

while (($#)); do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --marker-dir) MARKER_DIR="$2"; shift 2 ;;
    --evidence) EVIDENCE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; usage >&2; exit 2 ;;
  esac
done

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
ok() { echo "OK: $*"; }

git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "FAIL: запуск вне Git-репозитория" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git rev-parse --verify "${COMMIT}^{commit}" >/dev/null 2>&1 \
  && ok "commit существует: $(git rev-parse --short "$COMMIT")" \
  || fail "commit не найден: $COMMIT"

if [[ "$(git status --porcelain)" == "" ]]; then
  ok "worktree чистая"
else
  fail "worktree не чистая; сначала зафиксируйте или уберите локальные изменения"
fi

subject_and_body="$(git show -s --format='%s%n%b' "$COMMIT" 2>/dev/null || true)"
if grep -Fqi "$ISSUE_KEY" <<<"$subject_and_body"; then
  ok "commit содержит ключ $ISSUE_KEY"
else
  fail "commit не содержит ключ $ISSUE_KEY"
fi

if git show-ref --verify --quiet refs/remotes/origin/dev; then
  if git merge-base --is-ancestor "$COMMIT" origin/dev; then
    ok "commit опубликован в origin/dev: $(git rev-parse --short origin/dev)"
  else
    fail "commit не является предком origin/dev; публикация в dev не подтверждена"
  fi
else
  fail "нет локальной ссылки origin/dev; выполните git fetch origin dev"
fi

if git diff-tree --check --no-commit-id -r "$COMMIT"; then
  ok "в commit нет whitespace-ошибок"
else
  fail "commit содержит whitespace-ошибки"
fi

# Только контуры с кодовыми изменениями требуют deployment marker. Docs/scripts-only
# изменения не должны искусственно блокироваться отсутствием web/api marker.
changed_paths="$(git diff-tree --no-commit-id --name-only -r "$COMMIT")"
declare -A surfaces=(
  [web]="apps/web packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json"
  [api]="apps/api packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json"
  [device-agent]="apps/device-agent packages/moonraker-adapter packages/contracts packages/config package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json"
  [relay]="apps/relay packages/contracts packages/config"
)
for surface in web api device-agent relay; do
  affected=0
  for path in ${surfaces[$surface]}; do
    if grep -E "^${path}(/|$)" <<<"$changed_paths" >/dev/null; then affected=1; break; fi
  done
  ((affected)) || continue
  marker="$MARKER_DIR/$surface.sha"
  if [[ -r "$marker" ]] && [[ "$(tr -d '[:space:]' <"$marker")" == "$(git rev-parse "$COMMIT")" ]]; then
    ok "$surface marker подтверждает commit"
  else
    fail "$surface marker не подтверждает commit (ожидался $(git rev-parse "$COMMIT"))"
  fi
done

if [[ -n "$EVIDENCE" ]]; then
  if [[ ! -r "$EVIDENCE" ]]; then
    fail "evidence не читается: $EVIDENCE"
  else
    # Evidence обязано явно фиксировать recovery и границы: это не попытка
    # доказать печать/прошивку, а проверка отказа credential в безопасном dev.
    for term in recovery production; do
      grep -Eiq "$term|прод" "$EVIDENCE" || fail "evidence не содержит границу: $term"
    done
    if grep -Eiq 'recovery.*(pass|success|подтвержд|пройд)|восстанов.*(успеш|подтвержд|пройд)' "$EVIDENCE"; then
      ok "evidence подтверждает успешный recovery"
    else
      fail "evidence не подтверждает успешный recovery"
    fi
    grep -Eiq 'печать|прошив' "$EVIDENCE" || fail "evidence не фиксирует запрет печати/прошивки"
    grep -Eiq 'secret|credential|секрет' "$EVIDENCE" || fail "evidence не описывает credential/секрет"
    ((failures)) || ok "evidence содержит recovery и безопасностные границы"
  fi
else
  fail "не передан --evidence: recovery первой волны не подтверждён"
fi

if ((failures)); then
  echo "ИТОГ: BLOCKED ($failures проверок)" >&2
  exit 1
fi
echo "ИТОГ: ACCEPTED — кодовую карточку можно передавать только после отдельной проверки публичного dev smoke"
