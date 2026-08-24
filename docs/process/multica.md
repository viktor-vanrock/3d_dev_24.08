# Multica для агентов — как работать

> **Глубокая механика (токены/assign/автопилоты/демон/грабли, выстрадано)** — `multica.internals.md`. Этот файл — как ПОЛЬЗОВАТЬСЯ, тот — как оно РАБОТАЕТ.

Гайд для агентов (в т.ч. ассистента Claude) по работе с доской задач Multica на `tasks.3mf.tech`.
Про доску вообще, доступ людей и правила карточек — `docs/process/tasks.multica.md`. Здесь — **как оперировать программно**, в двух режимах:

- **Режим A — API/CLI:** агент только **ведёт** задачи (создаёт, назначает, обновляет статусы, комментирует). Демон не нужен. Это режим ассистента и любого headless-помощника.
- **Режим B — Демон:** на машине установлен агент-CLI (Claude Code, Codex и т.п.) и запущен демон Multica → машина становится **раннером**, и назначенные агенту задачи **выполняются автономно** прямо на ней.

Оба режима — поверх одного и того же API/CLI, различаются наличием запущенного демона.

---

## Аутентификация (общее для обоих режимов)

- Вход CLI — **только по токену:** `multica login --token <PAT>`. PAT берётся в вебе: `tasks.3mf.tech` → Settings → Tokens.
- Браузерный `multica setup self-host` за PlagID-гейтом **не проходит** (редирект на Telegram теряет CLI-callback) — не использовать.
- Гейт пропускает запросы с заголовком `Authorization` (машины по Bearer-PAT), браузеры — по cookie. Поэтому CLI/API работают и с внешнего адреса `https://tasks.3mf.tech`.
- Прямой API (без CLI): `Authorization: Bearer <PAT>`, базовый префикс `/api` (напр. `GET https://tasks.3mf.tech/api/workspaces`). Воркспейс — `3mf`, префикс задач `MF`.

---

## Режим A — API/CLI (вести задачи)

Ничего ставить не нужно, кроме `multica` CLI + `login --token`. Задача ассистента — держать доску живой.

```bash
multica issue list --limit 20 [--status in_progress]     # что в работе
multica issue create --title "…" --description "…" --priority high
multica issue update MF-12 --status in_progress           # взял в работу
multica issue status MF-12 done                           # завершил
multica issue comment MF-12 --body "…"                    # комментарий/лог
multica issue assign MF-12 --to "<member|agent|squad>"    # назначить
multica issue get MF-12                                    # детали
```

Правила оформления карточек (заголовок/описание/приоритет/статусы, шаблон и пример) — `docs/process/tasks.multica.md` § «Как оформлять карточки». Рабочая договорённость: поручение ассистенту = карточка на доске со статусом.

Прямой API-эквивалент (без CLI):

```bash
curl -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -X POST https://tasks.3mf.tech/api/issues \
  -d '{"title":"…","description":"…","priority":"high"}'
curl -H "Authorization: Bearer $PAT" https://tasks.3mf.tech/api/issues
```

---

## Режим B — Демон (исполнять задачи на машине)

Когда на компе есть агент-CLI и запущен демон, машина регистрируется как **раннер** (по одному на каждый детектированный провайдер), и агент может **сам выполнять** назначенные задачи.

### Понятия
- **Runtime (раннер)** — среда исполнения: `<провайдер>@<машина>` (напр. `claude`, `codex`). Появляется, когда демон видит установленный CLI. Статус `online/offline`.
- **Agent (агент)** — профиль-исполнитель, привязанный к раннеру: имя, модель, инструкции, скиллы, MCP, лимиты. Раннер — это «где», агент — это «кто/как». По умолчанию агентов нет, их создают.
- **Task/Run** — исполнение назначенной задачи агентом; у задачи есть история ранов и сообщения.

### Запуск демона
```bash
multica setup self-host --server-url https://tasks.3mf.tech --app-url https://tasks.3mf.tech  # один раз (или config set)
multica login --token <PAT>
multica daemon start          # поднять демон (обнаружит установленные агент-CLI)
multica daemon status         # running? какие агенты/воркспейсы
multica runtime list          # online-раннеры
```

**Живой пример — сквад Autofab** (CTO → Lead → {Design, Fullstack, Data, PM} → разрабы + пайплайн), иерархия/роли/правила — `docs/process/squad.multica.md`.

### Создать агента и дать ему задачу
```bash
multica runtime list                          # взять RUNTIME_ID нужного провайдера
multica agent create --name "Claude-3mf" \
  --runtime-id <RUNTIME_ID> \
  --model claude-sonnet-5 \
  --thinking-level high \
  --instructions "Работаешь по репо portal.ru. Соблюдай CONTRIBUTING.md и нейминг." \
  --max-concurrent-tasks 2
multica agent list                            # проверить

multica issue assign MF-12 --to "Claude-3mf"  # назначить → раннер подхватит и выполнит
```

### Следить и управлять
```bash
multica issue runs MF-12          # история исполнений
multica issue run-messages <task> # сообщения/прогресс
multica issue rerun MF-12         # перезапустить назначение
multica issue cancel-task <task>  # прервать выполнение
multica issue usage MF-12         # расход токенов
multica agent tasks <agent-id>    # что у агента в работе
```

### Важно / грабли
- **Ключи и расход — на машине с демоном.** Агент исполняет через локальный CLI (напр. Claude Code) с его аутентификацией; токены/деньги идут оттуда. Автономного исполнителя включать осознанно.
- **Демон должен быть запущен** — если машина уснула/демон упал, раннер `offline`, задачи не берутся.
- **Изоляция:** демон создаёт рабочие директории под задачи. Модель — ДВЕ ВЕТКИ (main+dev): параллельные правки идут в общий `dev` с `git rebase origin/dev` перед пушем, отдельных веток не заводим (`CONTRIBUTING.md` § «Ветвление», `git.hygiene.md`).
- **Скиллы/MCP/env агента** задаются при `agent create`/`agent update` (`--skills`, `--mcp-config-*`, `--custom-env-*`) — секреты передавать через `*-stdin`/`*-file`, не в командной строке.
- **Autopilot** (`multica autopilot`) — расписание/вебхуки для регулярного запуска агента без ручного назначения.

---

## Когда какой режим

| Нужно | Режим |
|---|---|
| Вести задачи, статусы, назначать, комментировать | **A (API/CLI)** — ассистент по умолчанию |
| Чтобы агент САМ писал код/выполнял задачу на машине | **B (Демон)** — на машине с агент-CLI и ключами |
| Регулярный автозапуск (cron/вебхук) | **B + Autopilot** |

Текущее состояние (2026-07-04): на Маке Валерия демон поднят, online-раннеры `claude`/`codex`/`hermes`/`openclaw`; агент-профили ещё не созданы (`agent list` пуст) — доска работает в режиме A, режим B готов к включению по решению.
