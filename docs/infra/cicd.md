# CI/CD: runbook создания и поддержания пайплайнов

Runbook для тех, кто правит или добавляет шаги CI/CD в portal.ru.
Основан на проверке контура 2026-07-06 (MF-488, MF-490).

---

## 1. Карта контура

### Что где живёт

| Файл/юнит | Назначение |
|---|---|
| `.gitverse/workflows/ci.yaml` | Lint / typecheck / test / build / audit на PR и push в main |
| `.gitverse/workflows/release.yaml` | Автобамп версии (MINOR+1) + тег, push в dev (MF-1792, было main до 2026-07-08) |
| `.gitverse/workflows/deploy.yaml` | **Заглушка**. Будущий ручной деплой по тегу (раннер `[deploy]` не зарегистрирован) |
| `deploy/portal.deploy.sh` | Скрипт автодеплоя: pull origin/main → сборка → рестарт api |
| `deploy/portal.deploy.service` | systemd oneshot-юнит, запускает `portal.deploy.sh` |
| `deploy/portal.deploy.timer` | systemd timer: 1 раз в минуту, Persistent=true |
| `deploy/portal.deploy.sudoers` | Шаблон drop-in sudoers — passwordless `systemctl restart portal.api` |
| `deploy/portal.deploy.rules.md` | Правила: `~/portal.ru` принадлежит только таймеру |
| `scripts/version.mjs` | Бампает `version.json`: `bump` (MINOR+1) или `release` (RELEASE+1, MINOR=1) |
| `version.json` | Источник истины по версии: `{ year, release, minor }` |

### Порядок срабатываний

```
Событие             → Workflow(s)                   → Что происходит
─────────────────────────────────────────────────────────────────────
PR → main           → ci.yaml                       → lint/test/build (без merge-гейта)
push → main         → ci.yaml                       → lint/test/build (версию НЕ бампает)
push → dev          → release.yaml                  → job version → бамп MINOR, тег, push [skip ci] прямо в dev
[skip ci] push      → ни один release-job не запускается (фильтр в release.yaml)
workflow_dispatch   → release.yaml (action=release) → RELEASE+1, MINOR=1, push в ref дискатча (обычно main)
VDS, каждую минуту  → portal.deploy.timer     → git fetch; origin/main вперёд → сборка → restart portal.api (3mf.tech)
VDS, каждую минуту  → portal.deploy-dev.timer → git fetch; origin/dev  вперёд → сборка → deploy на dev.3mf.tech
промоушен dev→main  → git push origin dev:main (Lead/директор, ff) → см. «push → main»; версию не трогает
```

**Модель ветвления — ДВЕ ВЕТКИ** (`CONTRIBUTING.md` § «Ветвление», правило оператора 2026-07-08): `dev` — общий рабочий ствол (деплой на dev.3mf.tech), `main` — прод. Выкатка на прод = промоушен `dev→main` (ff, после проверки на dev.3mf.tech); отдельных feature-веток нет.

**Защита от цикла**: release.yaml коммитит `version.json` с `[skip ci]` в сообщении. Job `version` дополнительно не запускается, если `head_commit.message` содержит `[skip ci]`. Двойная защита подтверждена на реальных прогонах (последний раз — MF-1792, 2026-07-17).

**История (MF-1792, 2026-07-17):** до 2026-07-08 job version триггерился на push в `main` и джоб `sync-dev` возвращал коммит версии обратно в `dev` (ff/auto-merge). После перехода на модель двух веток реальная интеграция ушла в `dev`, `main` стал обновляться редко ручным промоушеном — триггер на `main` молчал 6 дней/668 коммитов. Починено переносом триггера на push в `dev`; job `sync-dev` удалён — версия сразу коммитится в `dev`, синкать в dev больше нечего. `main` этот workflow больше не трогает вовсе (кроме ручного `workflow_dispatch action=release` при нарезке релиза).

### Multica демон и агент-вотчер

**Демон multica-daemon** (VDS, systemd-юнит):
- Служба: `/etc/systemd/system/multica-daemon.service`
- Логи: `journalctl -u multica-daemon` (не `~/.multica/daemon.log`)
- Назначение: демон Multica, запускает агентов из очереди задач `tasks.3mf.tech`, синхронизируется с доской.

**Вотчер portal-watchdog.timer** (VDS):
- Служба: `/etc/systemd/system/portal-watchdog.timer`
- Назначение: мониторинг здоровья сервиса (периодическая проверка health-endpoint, уведомления при падении).

**Ресурсные лимиты (systemd cgroup):**
- Параллельные агент-раны: `cap=2` (максимум 2 одновременных запуска; остальные проходят через admission и durable outbox; повышение только после недельных метрик).
- Лимиты памяти через cgroup — настраиваются в юнит-файле, см. `docs/infra/readme.md` § «Ресурсы».

---

## 2. Как создать новый pipeline/шаг

### Раннер

Всё CI (ci.yaml, release.yaml) крутится на **облачном `ubuntu-latest`** GitVerse.
Образ — `gitverse.ru/gitverse/runner-image:ubuntu-latest` — **голый**, без предустановленных Node/Python/pnpm. Ставить явно в каждом job'е.

Self-hosted раннер с меткой `deploy` — **не зарегистрирован**; deploy.yaml-джобы не выполняются.

### Единственный подтверждённый внешний экшен

`actions/checkout@v4` (зеркалируется как `gitverse.ru/actions/checkout`) — работает.
Никаких других `uses:` в репо нет. Добавляя новый экшен, проверь его наличие в реестре GitVerse перед merge.

### Синтаксис контекста GitVerse

GitVerse переименовал стандартные контексты:

| GitHub Actions | GitVerse Actions |
|---|---|
| `github.event_name` | `gitverse.event_name` |
| `github.event.head_commit.message` | `gitverse.event.head_commit.message` |
| `github.event.pull_request.base.sha` | `gitverse.event.pull_request.base.sha` |
| `github.event.inputs.*` | `gitverse.event.inputs.*` |
| `GITHUB_OUTPUT` | `GITHUB_OUTPUT` (совместимость сохранена) |

Аналогия 1:1 с GitHub подтверждена для push/PR-событий (run #1061119, #1060659). PR-путь (`pull_request.base.sha`) на реальных прогонах не проверялся — PR в репо не создавались.

### Фильтрация по путям (job `changes`)

**Обязательный паттерн** для любого нового job'а, затрагивающего часть монорепо:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      myapp: ${{ steps.filter.outputs.myapp }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Определить затронутые части монорепо
        id: filter
        run: |
          if [ "${{ gitverse.event_name }}" = "pull_request" ]; then
            BASE="${{ gitverse.event.pull_request.base.sha }}"
          else
            BASE="HEAD~1"
          fi
          CHANGED=$(git diff --name-only "$BASE" HEAD || true)
          if echo "$CHANGED" | grep -qE '^apps/myapp/'; then
            echo "myapp=true" >> "$GITHUB_OUTPUT"
          else
            echo "myapp=false" >> "$GITHUB_OUTPUT"
          fi

  myapp-job:
    needs: changes
    if: needs.changes.outputs.myapp == 'true'
    runs-on: ubuntu-latest
    steps:
      ...
```

Фильтрация подтверждена: пуш с изменением только `.md` → `node=skipped`, `python=skipped`.

### Добавить новый путь в существующий фильтр

В `ci.yaml`, job `changes`, шаг `filter`:

```bash
# Добавить к условию node-джоба:
if echo "$CHANGED" | grep -qE '^(apps/web/|apps/api/|packages/|НОВ_ПУТЬ/)'; then
  echo "node=true" >> "$GITHUB_OUTPUT"
```

Изменить фильтр python аналогично (добавить `|apps/newpython/` к grep-паттерну).

### Установка рантаймов в job'е

**Node + pnpm:**
```yaml
- name: Установить Node + pnpm
  run: |
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    corepack enable
    corepack prepare pnpm@9.15.0 --activate
```

**Python (uv):**
```yaml
- name: Установить uv
  run: curl -LsSf https://astral.sh/uv/install.sh | sh
- name: Lint + тесты
  working-directory: apps/myapp
  run: |
    export PATH="$HOME/.local/bin:$PATH"
    uv sync
    uv run ruff check .
    uv run pytest
```

### `[skip ci]` — не ломать

Job `version` в release.yaml защищён условием:
```yaml
if: |
  gitverse.event_name == 'workflow_dispatch' ||
  (gitverse.event_name == 'push' && !contains(gitverse.event.head_commit.message, '[skip ci]'))
```

**Правило**: не убирать это условие и не добавлять новые job'ы в release.yaml без аналогичного фильтра. Иначе — бесконечный цикл push→version→push.

**Версию не трогаем руками** — CI бампает сам. Исключение: ручной `workflow_dispatch` с `action=release` (только оператор).

---

## 3. Как поддерживать существующий контур

### Ответственные роли

| Роль | Зона ответственности |
|---|---|
| **Test** (Sonnet) | Содержание и развитие тестов (vitest, pytest). Гейт тестов в CI — Test решает, пропустить ошибку тестов или заблокировать merge. |
| **Ops** | Инфра CI: раннеры GitVerse, ресурсы, регистрация/деактивация. Systemd-юниты VDS (таймеры деплоя, вотчер). Доступы Git/API. |

**Velocity-этос:** максимум автономии для агентов; лучше хотя бы один баг выпустить, чем держать много кода в работе. Test смотрит на опасные баги, остальное → фикс-карточки параллельно (Reviewer).

### Чек-лист перед merge yaml-изменений

- [ ] yaml-синтаксис проверен (можно: `python3 -c "import yaml; yaml.safe_load(open('.gitverse/workflows/ci.yaml'))"`)
- [ ] Условие `!contains([skip ci])` в release.yaml не убрано
- [ ] Новый job использует `ubuntu-latest` (не `self-hosted`, если нет зарегистрированного раннера)
- [ ] Новый внешний `uses:` (экшен) существует в реестре GitVerse
- [ ] Путь в фильтре job `changes` добавлен, если появилось новое приложение/пакет
- [ ] `permissions: contents: write` не убрано из release.yaml (нужно для push тега)
- [ ] Job `version` пушит только в ref, который его запустил (`dev` на push, ref дискатча на workflow_dispatch) — никогда жёстко в `main`

### Что проверить локально перед merge yaml-изменений

```bash
# Синтаксис yaml
python3 -c "import yaml; yaml.safe_load(open('.gitverse/workflows/ci.yaml'))"
python3 -c "import yaml; yaml.safe_load(open('.gitverse/workflows/release.yaml'))"

# Проверить, что [skip ci] не убран (grep должен что-то найти)
grep -n "skip ci" .gitverse/workflows/release.yaml
```

Живой прогон CI — только после push в ветку и создания PR (или push в main).

### Как безопасно менять `deploy/portal.deploy.sh`

`portal.deploy.sh` — критический скрипт прода. Правила:

1. `set -euo pipefail` в первой строке — не убирать.
2. `flock -n 200` — защита от параллельных запусков — не убирать.
3. Guard ветки (`git branch --show-current` → если не `main` → `git checkout -f main`) — не убирать.
4. `git reset --hard origin/main` вместо `git pull --ff-only` — устойчиво к diverged-состоянию, не менять на pull.
5. Блок рестарта (`sudo systemctl restart portal.api`) — ПОСЛЕ `pnpm build`, НИКОГДА до него. Скрипт должен завершиться с exit 1 при ошибке сборки до рестарта.
6. Новый сервис для авто-рестарта добавить по образцу api-блока:
   ```bash
   if git diff --name-only "$LOCAL_HEAD" "$REMOTE_HEAD" -- apps/новый/ | grep -q .; then
     echo "portal.deploy: apps/новый/ изменился, перезапускаем portal.новый"
     sudo systemctl restart portal.новый
   fi
   ```
   Не забыть добавить строку в `deploy/portal.deploy.sudoers` (шаблон на VDS — `/etc/sudoers.d/portal.deploy`).
7. После правки скрипта — **не запускать вручную** в `~/portal.ru` (принадлежит таймеру). Закоммитить, дождаться pull таймером (≤1 мин), проверить journalctl.

### `~/portal.ru` — только таймер, не трогать руками

Единственный легальный писатель в `~/portal.ru` — `portal.deploy.timer` (и в `~/portal.ru-dev` — `portal.deploy-dev.timer`). Агенты работают в task-workdir демона Multica; ни `~/portal.ru`, ни `~/portal.ru-dev` руками не трогают. Нарушение блокирует деплой (подробнее — `deploy/portal.deploy.rules.md`).

---

## 4. Диагностика

### Где логи

```bash
# Все прогоны portal.deploy (VDS-таймер)
journalctl -u portal.deploy

# Последние N строк в реальном времени
journalctl -u portal.deploy -n 50 -f

# С конкретного момента
journalctl -u portal.deploy --since "2026-07-06 20:00:00"

# Статус юнита (последний код выхода, pid, время старта)
systemctl status portal.deploy

# Состояние таймера (когда следующий запуск)
systemctl list-timers portal.deploy.timer
```

### Как понять, что VDS-деплой упал

Симптомы:
- `systemctl status portal.deploy` показывает `status=1` или `(code=exited, status=1/FAILURE)`
- В journalctl строки вида: `portal.deploy: pnpm build упал, portal.api НЕ перезапускается`
- Счётчик `/tmp/portal.deploy.fail_count` > 0
- После 3 тиков подряд с ошибкой — уведомление в Telegram (через `/home/plag/tg-bridge/queue`)

**Что делать:**
1. `journalctl -u portal.deploy -n 30` — найти причину (ошибка сборки / сетевая ошибка / конфликт)
2. Если причина в коде приложения — завести карточку на разработчика, прод остаётся на старой версии
3. Если причина в инфре (диск, сеть, зависимости) — устранить руками на VDS
4. Сбросить счётчик после устранения: `rm /tmp/portal.deploy.fail_count` (таймер сбросит его сам при следующем успешном прогоне)

### Как читать статус юнита

```
● portal.deploy.service - portal.ru autodeploy
   Loaded: loaded (/etc/systemd/system/portal.deploy.service; static)
   Active: inactive (dead) since ...    ← последний прогон завершён (oneshot — это норма)
  Process: 12345 ExecStart=... code=exited, status=0/SUCCESS   ← OK
  Process: 12345 ExecStart=... code=exited, status=1/FAILURE   ← падение, смотреть логи
```

`oneshot`-юнит после завершения всегда переходит в `inactive (dead)` — это норма, не проблема. Проблема — `status=1`.

### Ручной откат (аварийный)

Автоматического отката нет. При падении сборки прод **остаётся на предыдущей рабочей версии** (portal.api не перезапускается). Это само по себе является защитой.

Если нужно явно вернуться на конкретный коммит:

```bash
# На VDS, от пользователя plag:
cd /home/plag/portal.ru

# Найти нужный коммит/тег
git log --oneline -20
git tag --sort=-version:refname | head -10

# Откатить рабочую копию на нужную версию
git reset --hard <коммит-или-тег>

# Пересобрать (если нужно)
pnpm install --frozen-lockfile && pnpm build

# Перезапустить api вручную
sudo systemctl restart portal.api

# Проверить
systemctl status portal.api
curl -s https://api.3mf.tech/health
```

**Внимание:** при следующем тике таймера (≤1 мин) `portal.deploy.sh` сделает `git reset --hard origin/main` и вернёт рабочую копию на HEAD main. Если нужно зафиксировать откат дольше — остановить таймер на время (`sudo systemctl stop portal.deploy.timer`), после решения проблемы запустить снова (`sudo systemctl start portal.deploy.timer`).

### Проверка health прода после изменений

```bash
# С любой машины (в т.ч. с VDS):
curl -s https://3mf.tech/ -o /dev/null -w '%{http_code}\n'          # 200
curl -s https://api.3mf.tech/health                                   # {"status":"ok","service":"api"}
```

### PAT для автодеплоя — минимальный scope

`portal.deploy.sh` на VDS делает только `git fetch origin main` + `git reset --hard origin/main` — **никогда push**. Git-credential (PAT), под которым таймер тянет репозиторий, должен иметь **read-only scope на содержимое репозитория** (аналог GitHub `contents: read` / Gitea-scope `read:repository`) — и **ничего больше**:

- **БЕЗ** `write:repository` / push-доступа — деплой в репозиторий никогда не пишет.
- **БЕЗ** Actions/`write:secrets`/admin — это отдельные права, нужные только для CI/CD-раннера и Public API (регистрация раннера, секреты, ручной `workflow_dispatch` — см. `docs/infra/readme.md` § «CI/CD-раннер», «GitVerse Public API»), под них — отдельный PAT, не деплойный.

Заводя новый PAT для автодеплоя, выбирай только этот минимальный scope. Токен с лишними правами увеличивает ущерб при утечке `~/.git-credentials` на VDS, не давая автодеплою ничего взамен.

Источник: ревью GigaCode на PR #14 (MF-491), передано через MF-579.

---

## 5. Известные пробелы (на вердикт CTO, не чинить здесь)

По итогам ресёрча MF-488 и функциональной проверки MF-490:

| Пробел | Статус | Описание |
|---|---|---|
| Нет branch protection на main | Известно | Прямой push в main возможен — CI не обязателен до merge. Включить branch protection в GitVerse нельзя через API (нет эндпоинта) — только через UI. Release.yaml сам пушит в main, потребует исключения. |
| Нет алертинга падения VDS-сборки | Частично | 3 ошибки подряд → уведомление в Telegram-мост. Но одиночные падения не алертируются — только через ручную проверку journalctl. |
| `portal.mesh-worker` не рестартится авто | Известно | `portal.deploy.sh` проверяет только `apps/api/`. При изменениях `apps/mesh/` mesh-worker требует ручного `sudo systemctl restart portal.mesh-worker`. |
| Staging-контур — заглушка | Известно | `release.yaml` (job `deploy-staging`) и `deploy.yaml` содержат `echo no-op`. Реального staging-контура нет. |
| Self-hosted раннер `[deploy]` не зарегистрирован | Известно | Требуется бинарь именно с панели GitVerse (не с dl.gitea.com). Детали регистрации — `docs/infra/readme.md` § «CI/CD-раннер». До регистрации deploy.yaml-джобы не исполняются. |
| CI на PR не проверялся | Известно | PR в репо никогда не создавались, все пуши шли напрямую в main. Путь `pull_request.base.sha` в ci.yaml не отрабатывался на реальном раннере. |
| GitVerse Actions/status API → 400 | Известно | GitVerse Public API не возвращает статус прогонов (400 ошибка). Следствие: агенты не могут запросить статус рана через API — **самопроверка локально** (pull + проверка кода) вместо polling статуса. Test и Ops ведут статус вручную из мониторинга журналов. |
| Отсутствие Postgres в api-тестах | В работе | CI крашится на `apps/api/` тестах при отсутствии БД. Чинится в MF-670 (добавление docker-compose в CI для локального Postgres). До исправления api-тесты скипуются. |

Предложения по устранению (переход от pull-таймера к push-деплою, staging, branch protection, полный алертинг) — требуют архитектурного вердикта CTO.
