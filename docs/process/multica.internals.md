# Multica — внутренняя механика (выстрадано)

Глубокие механики self-hosted Multica на VDS, найденные болезненной отладкой (2026-07-08…09). Это НЕ «как пользоваться доской» (то — `multica.md`), а «как оно реально работает под капотом» + все хелперы и грабли. Читать при любой работе с оркестрацией агентов. Разделы 10–13 — инфра/автоматика/CI/релизы, добавлены 2026-07-09.

## 1. Как агент ЗАПУСКАЕТСЯ (главное)

**Агент запускается ТОЛЬКО когда:**
- карточка НАЗНАЧЕНА на него (`multica issue assign MF-N --to <Имя>`) — новый assignee → новый ран;
- `multica issue rerun MF-N` — переочередь текущего assignee;
- сработал **событийный webhook-автопилот**. Schedule технически поддерживается
  Multica, но запрещён организационным контрактом проекта.

**Mention НЕ будит НИКОГО** — даже валидный `[@Имя](mention://agent/<uuid>)`. Это мёртвый текст, только контекст для человека и для того, кто СЛЕДУЮЩИМ откроет карточку. Доказано: комменты с тегами @Ops/@Lead не создали ни одного рана (2ч тишины). **Вся передача работы = переназначение карточки (hot-potato), не тег.** Это был корень «поговорили и всё встало».

**Класс застоя «ран завершён, карточка стоит»:** агент отработал ход, ран `completed`, но карточку не продвинул (не reassign / не сменил статус) → больше ничто не триггерит → стоит вечно (видели 18–20ч). Лечится авто-`rerun` (см. вотчер) и правилом «сессия кончается действием на доске».

## 2. Токены агентов — двойной гейт на assign

Демон инжектит каждому рану **урезанный per-task токен** `MULTICA_TOKEN=mat_…` (Multica Agent Token, виден в env агент-процессов). У него:
- create / comment / status / update / list / get — **работают**;
- **assign / rerun / cancel-task — НЕДОСТУПНЫ**, двойной гейт:
  1. **сервер** режет права mat_-токена (403);
  2. **сам бинарь** в агент-контексте (детектит env `MULTICA_TASK_ID`) требует именно mat_ и **отвергает операторский токен** («agent execution context requires MULTICA_TOKEN to be a task-scoped mat_ token»).

Штатного тумблера прав нет (`--permission-mode` = про вызов агента; global `--token` флага у команд нет; бэкенд `ghcr.io/multica-ai/multica-backend:latest` — ограничение зашито).

**Фикс — PATH-обёртка `/usr/local/bin/multica`** (реальный бинарь → `multica.real`). **v3 (2026-07-09):** бинарь обновился до **0.3.40 (собран 07-07)** и детектит agent-контекст не только по `MULTICA_TASK_ID`, а ещё по `MULTICA_DAEMON_PORT`/`MULTICA_SERVER_URL`/`MULTICA_WORKSPACE_ID` (репро: минимальный env проходил, полный agent-env падал ТОЧНОЙ ошибкой агентов → это сломало ВСЮ эстафету на ночь, карточки застряли). Поэтому обёртка теперь:
1. снимает **ВСЕ** `MULTICA_*` (future-proof: `env | grep -oE '^MULTICA_[A-Z0-9_]+' | grep -vx MULTICA_TOKEN | sed 's/^/-u /'`), кроме токена — его ставит операторский `mul_` из `~/.multica/config.json` (`SERVER_URL`/`WORKSPACE_ID` подхватываются из config, не ломаются);
2. элевейтит не только `issue assign/rerun/cancel-task`, а **ЛЮБОЙ флаг назначения** (`--assignee/--assignee-id/--to/--to-id`) — агенты зовут и `issue update --assignee` (это отдельно ломало Design→Front).

Остальное (create/comment/status без назначения) — без подмены, от имени агента (атрибуция цела). Санкционировано оператором (self-hosted, автономия). **⚠️ Дурабильность: апдейт multica может перезаписать обёртку И добавить новый context-var** — v3 закрывает второе (grep-all), но при апдейте обёртку переустановить (шаблон `scratchpad/multica-wrapper-v3.sh` в сессии; демон под `--no-auto-update`, авто-апдейта нет). Проверка репро: `MULTICA_TASK_ID=x MULTICA_DAEMON_PORT=1 MULTICA_SERVER_URL=https://tasks.3mf.tech MULTICA_WORKSPACE_ID=… MULTICA_TOKEN=mat_fake /usr/local/bin/multica issue assign MF-N --to Имя` должен ПРОЙТИ (до v3 — падал).

## 3. custom_env НЕ инжектится в раны

`multica agent env set <id> --custom-env '{…}'` сохраняет, но демон **не прокидывает** эти переменные в env агент-рана (проверено: `GIT_AUTHOR_NAME`, `MULTICA_AGENT_NAME` отсутствуют в env процессов). Последствия:
- git-атрибуция: демон ставит ВСЕМ агентам общий `git config user.name=lead, email=a@b.c` в task-workdir → не видно кто shipped. **Обход:** агент сам штампует `git config user.name "<роль>"` первым делом (в промптах).
- `MULTICA_AGENT_NAME` нет → `ask-operator` показывает «агент» вместо роли (минор).

## 4. Автопилоты (единственный «будильник» кроме assign)

Видны в UI (вкладка Autopilots, с историей ранов). Создание:
```bash
multica autopilot create --title "…" --agent <Имя> --mode run_only --description "<промпт задачи>"
multica autopilot trigger-add <apid> --kind webhook   # → webhook_token
```
- **webhook** — дёргается POST'ом на `http://127.0.0.1:8080/api/webhooks/autopilots/<token>` (ЛОКАЛЬНЫЙ бэкенд, мимо PlagID-гейта). Тело `{event, …payload}` доезжает агенту как `eventPayload`. Снаружи гейт требует любой `Authorization`-заголовок (иначе 302).
- `--mode run_only` (просто запуск агента) или `create_issue`.
- Ручной прогон: `multica autopilot trigger <id>` (без payload).

Текущая шина — `multica-event-router.service`: durable DB outbox, thresholds,
fingerprints и webhook URL в `/home/plag/.config/multica-event-router.json`
(`0600`). Точная схема — [autopilots.event-driven.md](autopilots.event-driven.md).
CI→Test использует отдельный прямой webhook. Cron-агентов нет.

## 5. Демон и task-workdir — СТУХШИЙ локальный чекаут (корень «работа в мусор»)

Демон на каждую задачу создаёт `~/multica_workspaces/<ws>/<task>/workdir/portal.ru` из кэша `~/multica_workspaces/.repos/…git` и авто-создаёт локальную ветку `agent/<роль>/<hash>` (по ней и назван подкаталог task-workdir). Грабли:
- **локальный чекаут в workdir СТУХШИЙ** (кэш демона отстаёт на десятки коммитов; его ветка залочена в worktree — форс-обновить нельзя);
- НО `origin` в workdir = настоящий `https://gitverse.ru/plag/portal.ru`, и `origin/dev` / `origin/main` там **СВЕЖИЕ**.

Раньше (старая мультибранч-модель) агенты branch'ились от стухшего локального main → main улетал вперёд (видели merge-base веток 2 дня / +124 коммита, diff 16–20к строк) → merge = конфликт на весь репо → **работа выбрасывалась**. **С 2026-07-08 модель — ДВЕ ВЕТКИ (main + dev, правило оператора):** отдельные ветки под задачу НЕ создаём, работаем в общем `dev`. Правило (в промптах всех агентов, блок «Git — ДВЕ ВЕТКИ»):
- ПЕРВЫМ делом уйти на свежий ОБЩИЙ dev: `git fetch origin dev && git checkout -B dev origin/dev` (авто-ветку `agent/*` демона бросаем и НЕ пушим — она локальная, умирает с workdir).
- Публикация с ребейзом: `git fetch origin dev && git rebase origin/dev && git push origin dev` (десятки параллельных пушей — норма; конфликт чинишь сразу — «своей» ветки, куда спрятаться, нет).
- Проверка живьём на **dev.3mf.tech** (таймер деплоит `origin/dev` ≤1 мин); `dev` держим зелёным (сломал — fix-forward немедленно).
- Выкатка на прод — промоушен `dev→main` (fast-forward; право Lead/директоров; после dev.3mf.tech-зелёного): `git push origin dev:main`. Отклонён как non-ff (в `main` уехал CI-коммит версии) → `git merge origin/main && git push origin dev`, повтори; **НЕ** `--force`, **НЕ** rebase общего `dev`.
- Полный процесс — `CONTRIBUTING.md` § «Ветвление»; гигиена/чистка легаси-веток — `git.hygiene.md`.

## 6. Скиллы

Только через воркспейс: `multica skill import --url <clawhub/skills.sh/github>` (в воркспейс) → `multica agent skills add <id> --skill-ids <…>`. Свой: `multica skill create --name … --content-file …`. Список: `multica skill list`. Скилл впрыскивается в контекст роли на каждой задаче — кривой тихо портит роль (governance у CTO, см. `skills.md`). Слабым моделям (PM/QA/Git/Docs) скиллы обычно вредны (сила в коротком чеклисте).

## 7. Карточки — полный паспорт

`multica issue create` флаги: `--parent` (эпик→подзадача, ДЕРЕВО 2 уровня), `--stage N` (барьер-группа: владелец эпика будится когда вся фаза done), `--project` (версия v1…v6), `--priority` (urgent=горит/high=критпуть/medium=в версии/low=выкидываемо; none=неоформлена), `--due-date`/`--start-date`, `--assignee`, `--label` (`multica issue label add`), metadata (`multica issue metadata set MF-N branch <ветка>` — по нему вотчер/QA находят ветку). **Грабля CLI:** `multica issue list --output json` кладёт список в ключ `issues`, НЕ `items`.

## 8. Хелперы на VDS (в PATH, /usr/local/bin/)

| Команда | Что |
|---|---|
| `mention <Имя>` | готовая строка `[@Имя](mention://agent/<uuid>)`; карта `/usr/local/etc/autofab-agents.map` |
| `ask-operator MF-N "текст"` | вопрос оператору в Telegram (кнопки Да/Нет/Отложить), ответ → коммент в карточку |
| `ask-operator-choice MF-N "?" A B C` | вопрос-опрос оператору |
| `webcheck <url> [--mobile --full --click SEL]` | Playwright-заход залогиненным (служебная сессия) → скрин/текст/консоль/сеть в `~/webcheck-out/` |
| `autofab-session-refresh` | пересоздать служебную агентскую сессию (`~/.autofab-session`) |
| `gigacode-review <pr>` | прочитать ревью gigacode-agent на PR |
| `gitverse-pr-comment <pr> "текст"` | ответить/закомментить PR (issue-тред) |
| `gitverse-pr-close <pr> [причина]` | закрыть PR после squash-merge (API PATCH state=closed) |
| `release-announce "текст"` | односторонний анонс в Telegram-чат (токен `TG_MAIN_TOKEN`+`TG_CHAT_ID` из `~/tg-bridge/.env`); юзается дайджестом/watchdog'ом/релизами |
| `setup-subbot <Label> <token>` | (свёрнуто) настроить саб-бота телеграм-моста |

Плюс инфра-сервисы: `multica-daemon.service` (§10),
`multica-event-router.service` и SQL outbox (§11), `~/tg-bridge/`,
`/usr/local/sbin/wan-policy-routing.sh`, `portal.deploy`/`portal.deploy-dev`.
Исходники router теперь лежат в `deploy/ops/`, а webhook secrets — только локально.

## 9. Сводка грабель (быстрый чеклист при отладке)

1. Агент «не откликается на тег» → тег не будит, нужен **assign**.
2. Карточка in_progress стоит с completed-раном → вотчер её `rerun`'ит; ручной `multica issue rerun`.
3. Агент «assign/`update --assignee` отдаёт 403 / requires mat_ token» → обёртка multica устарела под новый бинарь (v3, §2): снимает не все `MULTICA_*` или не элевейтит `update --assignee`. Проверь репро из §2; переустанови v3.
4. `multica issue list --output json` пустой парсинг → ключ `issues`, не `items`.
5. Массовые конфликты веток / «работа в мусор» → было: ветки от стухшего локального main. Теперь ДВЕ ВЕТКИ: работаем в общем `dev` от `origin/dev`, промоушен `dev→main` (§5).
6. Коммиты все от «lead» → дефолт демона; self-stamp git config (§3).
7. Карточка назначена, а раннера нет → assignee = удалённый агент (призрак) или squad; реассайн живому.
8. Почта/OTP не уходит с VDS → exit-node режет российский SMTP (Timeweb); маршрут мимо exit-node (`../infra/email.md`).
9. `MULTICA_AGENT_NAME`/custom_env нет в ране → не инжектится (§3).
10. gigacode-agent пишет ревью на PR как issue-comment → вотчер ловит, Git обрабатывает.
11. Логи демона не в `~/.multica/daemon.log` → под systemd (`--foreground`) демон пишет в **journald**: `journalctl -u multica-daemon`. Файл `daemon.log` стух после перехода на systemd — не читать его для мониторинга.
12. GitVerse Actions/releases/tags API отдаёт **400** (публичный API не поддерживает — только `/pulls`, `/issues`, `/hooks`). Статус CI-прогонов через API НЕ увидеть; релизы/теги — не через API. Обход в §12/§13.
13. Демон плодит раны быстрее, чем 4ГБ-бокс тянет → своп-трэшинг до полной заморозки (sshd/nginx не отвечают, TCP жив). Лечится cap + cgroup-лимиты (§10). Не путать с OOM-kill (в journald может не быть — journald сам умирает при заморозке).
14. Раннер `Claude (worker)` offline / агенты не берут задачи → демон не запущен: `systemctl status multica-daemon`; runtime online — `multica runtime list` (все 16+ агентов привязаны к нему, id `96531e2e`).
15. Раннер `Opencode (worker-ocsearch)` — ВТОРОЙ, полностью изолированный демон на `worker` (юзер `ocsearch`, `multica --profile ocsearch daemon start`, systemd `multica-daemon-ocsearch.service`) — не путать с основным `Opencode (worker)`, тот жжёт OpenRouter-баланс, этот подключён к локальным LLM на HYPERPC. Подробности, топология GPU-слотов, известный блокер (нет git-credentials на `gitverse.ru` для этого юзера) — [hyperpc.local.llm.md](hyperpc.local.llm.md).

## 10. Инфра демона и 4ГБ-бокса (инцидент 2026-07-09 + хардненинг)

**Инцидент:** пул агентов гнал ~15 ранов разом на **4ГБ-RAM** боксе (RAM в ноль → своп-трэшинг → sshd/nginx перестали отвечать, TCP принимался). Диагностика снаружи: `nc` на 22/443 проходит, а TLS+SSH-баннер висят = app-layer starvation. Лечится только ребутом (оператор через панель Timeweb; SSH мёртв).

**Хардненинг (сделан, держим на VDS, оператор отложил вынос агентов):**
- **Демон под systemd** `multica-daemon.service`: `ExecStart=/usr/local/bin/multica daemon start --foreground --max-concurrent-tasks 3`; `Restart=always`; `Environment=HOME=/home/plag PATH=/usr/local/bin:/usr/bin:/bin` (иначе дети-агенты не найдут `multica`/`claude`). Переживает ребут, авто-рестарт. Раньше запускался руками (после ребута — вручную).
- **cgroup-лимиты** (клетка для агент-ранов, прод вне неё): `MemoryHigh=2.3G MemoryMax=3G MemorySwapMax=4G OOMScoreAdjust=300`. При переборе ядро бьёт РАН внутри cgroup, не весь бокс. **cap=3** (был 2; running=N смотреть в journald). Поднимать выше — следя за `free -m`.
- **Своп 4→8G** (`/swapfile`, fstab), `vm.swappiness=10` (меньше преждевременного трэшинга).
- **sshd защищён от OOM** `OOMScoreAdjust=-900` (drop-in `/etc/systemd/system/ssh.service.d/oom.conf` + `/proc/<pid>/oom_score_adj`) — не терять доступ.
- **WS-скорость:** nginx `location /api/` не проксировал ws-upgrade → демон будился поллингом 30с; добавлены `proxy_http_version 1.1`+`Upgrade`/`Connection` → мгновенный wakeup (`journalctl`: `websocket connected`).

## 11. Автоматика «сигнал→агент» (обновлено 2026-07-13)

Модель: факт → durable outbox → threshold/dedupe → агент → действие. Multica
webhook остаётся транспортом, но URL знает только router/CI. Новый event сначала
описывается в [autopilots.event-driven.md](autopilots.event-driven.md), затем
маршрутизируется. Нельзя добавлять cron, который будит LLM без изменения
состояния.

Построено: DB triggers на `issue` и terminal `agent_task_queue`, outbox/fire-log,
deploy/site sensor в `portal.deploy-dev`, quota transition в `quota-guard`, прямой
CI-failure webhook. Успешные поставки coalesce: QA/5, Visual QA/3 web,
Release/10. Failure и recovery идут сразу. Старый PR watcher удалён с машины,
его автопилоты paused и лишены triggers.

## 12. CI/CD и §13 Релизы — кратко

**CI (`ci.yaml`, облачные `ubuntu-latest` РАБОТАЮТ — release.yaml тому подтверждение):** красный, т.к. api-**интеграционные** тесты падают `database "plag" does not exist` — нет `services: postgres`+dbmate-миграций (`apps/api/db/migrations/`, код цепляется через `process.env.DATABASE_URL` в `src/db/client.ts`). Web/lint/typecheck/build/audit зелёные. Владелец CI-тест-джоб — роль **Test**, раннер/деплой — **Ops**; фикс = MF-670. Статус ранов через API не виден (400) → CI помогает через: агенты self-verify локально + CI→Test вебхук (§11).

**Релизы (v14, MF-1792 2026-07-17):** MINOR капает сам на каждый пуш в **dev** (release.yaml; было main до перехода на две ветки — молчал 6 дней/668 коммитов, чинили MF-1792). RELEASE (26.2.x→26.3.x) режется по решению **ОПЕРАТОРА**; **CTO** курирует заметки, **Git** исполняет runbook (`scripts/changelog.mjs <range> --version X` генерит секцию `changelog.md` из Conventional Commits; `scripts/version.mjs peek release`; коммит `chore(release): vX [skip ci]`+тег+push main/dev; `release-announce`). Тег релиза — единственный санкц. ручной тег. GitVerse Releases API недоступен → источник заметок = `changelog.md`+тег+Telegram. Полное — `versioning.md`.

## Команда (актуально 2026-07-09): 18 агентов
CTO→Lead→{Design/Fullstack/Data/PM}→разрабы + пайплайн Lead (QA/Git/Docs/Ops/Cloud.ru) + **Reviewer** (async ловит баги→фикс-карточки, НЕ блокирует) + **Test** (автотесты+CI-тест-гейт). Модель всего флота — `claude-sonnet-5`. Философия оператора: **максимум автономии, минимум обсуждений, велосити важнее — «лучше баги зато много кода»** → качество через async-ловушки, не блокирующие гейты.

## 2026-07-16 — реорганизация доски: направления вместо v1–v6

- Проекты v1–v6 УДАЛЕНЫ; 12 проектов-направлений, канон: [board.projects.md](board.projects.md).
- Инцидент-вотчеры (`/usr/local/bin/{portal-watchdog,prod-error-watch,synthetic-watch}` на worker) заводят карточки в «Инфра и поставка» (`3787122e-…`), `dod-reconcile.py` — в «Оперирование» (`9e1776b8-…`). Исходники — `deploy/ops/` этого репо.
- Event-router на dev-vm (`~/event-router/multica-event-router.py`) переведён с фильтра `project_id=v1` на workspace-wide (бэкап `.bak-v1projects`; в конфиге `project_id` → `project_id_removed`).
- 🔴 Грабля: скрипты с хардкодом project UUID ломаются МОЛЧА при реорганизации доски — перед изменением проектов грепать UUID по `/usr/local/bin` всех машин и `deploy/` репо.
