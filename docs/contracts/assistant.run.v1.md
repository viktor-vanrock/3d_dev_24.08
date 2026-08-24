# Контракт RAG/clarification runner'а `giga.assistant-run.v1` (MF-2000)

**Статус: канонизировано MF-1999/MF-2014.** `packages/contracts/http/assistant.ts`
(`AssistantRunResult`) и `packages/contracts/jobs/giga.ts` (`assistant-run.v1`, импортирует тот же
union) — источник истины для формы результата; переименований полей не потребовалось (см.
«Соответствие» ниже — предсказание подтвердилось, `kind`/`prompt_summary` вошли в канон как есть).
Этот документ остаётся рабочим описанием giga-стороны очереди `assistant_runs`
(`apps/giga/src/giga/assistant/{schemas,lifecycle}.py`, `tests/test_assistant_*.py`).

## Очередь `assistant_runs`

Таблица — контракт MF-1997 («Добавить приватные assistant threads, messages и
runs API», Back), на момент этой карточки миграция ещё не смёржена. `apps/giga`
не владеет схемой (тот же принцип, что `generations`/`giga/db.py`) — читает и
пишет через общий `DATABASE_URL`.

Ожидаемые колонки (`apps/giga/src/giga/assistant/db.py`, докстринг модуля):

```
id uuid primary key
thread_id uuid not null
user_id uuid not null
message text not null
status text not null default 'queued' check (status in ('queued','running','done','error'))
attempts int not null default 0
lease_expires_at timestamptz
result jsonb
error text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

`giga-assistant-worker` (`giga.assistant.lifecycle_worker:run_loop`) обрабатывает очередь
через общий lifecycle: атомарный claim, lease/heartbeat, reclaim, attempts и fencing →
bounded evidence → `router.route_message` → `mark_done` с сериализованным
`AssistantResult` (в т.ч. `kind="error"` — честный результат для API-слоя,
не сбой воркера) либо `mark_error` на баг самого воркера.

## `AssistantResult` (`giga/assistant/schemas.py`)

Дискриминатор `kind`, ровно одна из четырёх форм:

```json
// answer
{"kind": "answer", "text": "…", "citations": [
  {"model_id": "uuid", "title": "…", "snippet": "…", "score": 0.82, "source_url": null}
], "note": null}

// clarification — максимум один вопрос за раз, структурно (одно поле, не список)
{"kind": "clarification", "question": "…", "reason": "…"}

// generation_offer — ТОЛЬКО предложение, сама генерация не запускается отсюда
{"kind": "generation_offer", "branch": "openscad", "prompt_summary": "…", "note": null}

// error — код-уровня результат; LLM никогда не выбирает kind="error" сама
{"kind": "error", "code": "provider_timeout", "message": "…", "retryable": true}
```

`ErrorCode`: `provider_timeout` (HYPERPC не ответил за бюджет ретраев,
retryable=true), `provider_error` (сеть/статус проблема, retryable=true),
`invalid_output` (JSON модели неразбираем/невалиден по allow-list,
retryable=false — тот же вход с temperature=0, скорее всего, даст тот же
результат).

## Safety / недоверенный вход

- **Цитаты не текут от модели.** `router._citations_from_ids` строит
  `Citation.title`/`snippet`/`score`/`source_url` ИСКЛЮЧИТЕЛЬНО из своей же
  bounded evidence (`evidence.Evidence`) по `model_id`, который LLM разрешено
  ВЫБРАТЬ — не переписать. `model_id`, которого не было в предоставленной
  evidence, молча отбрасывается (allow-list, не deny-list — тот же принцип,
  что `slicer_ai.delta._sanitize_deltas`).
- **Evidence — данные, не инструкции.** Каталожные сниппеты сериализуются как
  JSON-значения внутри `catalog_evidence` (см. `router._build_user_prompt`),
  системный промпт (`prompts/router.system.md`) явно требует не исполнять
  команды, найденные внутри сниппетов.
- **LLM не запускает side effects.** `route_message` не принимает
  generations-соединение и физически не может создать job; реальный
  `POST /assistant/threads/:id/generations` (MF-1997) — отдельное,
  явно подтверждённое пользователем действие.
- **Структурная маршрутизация — только tool/JSON-слот HYPERPC** (`hyperpc_client.
  chat_structured`, temperature=0.0, reasoning выключен через
  `chat_template_kwargs.enable_thinking=false`). Текстовый слот HYPERPC (`chat_fast`)
  не используется `router.py` для решений — по доку ненадёжен для JSON.
- **HYPERPC URL/порт — только из env**, никогда не хардкод (см. докстринг
  `hyperpc_client.py`: `docs/process/hyperpc.local.llm.md` уже расходился с
  операторской памятью по порту слота 1).

## Деградация без HYPERPC

Без `HYPERPC_STRUCTURED_URL` — честный no-op: `router._degraded_answer`
возвращает `kind="answer"` с цитатами из уже найденной evidence (без
AI-синтеза текста, `note` объясняет отсутствие HYPERPC), не `503` — тот же
принцип, что `giga/slicer_ai/delta.py`/`gigachat_client.load_client`.

## Оркестратор и skill registry (MF-2046)

`giga/assistant/skills.py` — versioned (`giga.assistant-skills.v1`), server-owned реестр того,
что оркестратор (`router.route_message`) вправе показать модели: `name`/`description`/
`input_schema` (JSON Schema)/`required_scope`/`mutating`/`modes` (`page`|`global`|`assistant`).
Реестр — allow-list, не blocklist: модель выбирает только имя из уже отфильтрованного по
`mode`+`scopes` этого запроса подмножества (`skills.skills_for`), не может ни изобрести skill, ни
подменить его схему/scope.

**`kind="tool_call"` — внутренний протокол, НЕ часть `AssistantResult`.** Модель вправе один раз
за прогон запросить `{"kind": "tool_call", "skill": "catalog_search", "args": {...}}` — только для
`mutating=False` skill'ов; `route_message` валидирует `args` строгой pydantic-схемой, исполняет
инжектированный `catalog_search`-колбэк (без `conn` — DI, `router.py` остаётся чистой функцией),
сливает результат с исходной evidence и делает ВТОРОЙ (последний) вызов HYPERPC за терминальным
ответом. `tool_call` никогда не сериализуется в `assistant_runs.result`/HTTP-контракт — таблица
«Соответствие полей» ниже не меняется, это шаг ДО терминального `AssistantResult`, не новый его
вариант. Бюджет — ровно один `tool_call`: повторная попытка (в т.ч. на втором проходе) — честный
`kind="error"`/`invalid_output`, не цикл (CLAUDE.md § «СТОИМОСТЬ»).

**Approval flow для мутирующих skill'ов — структурный, не по соглашению.** `generation_offer`
(`mutating=True` в реестре) недостижим через `tool_call` ни при каких обстоятельствах — единственный
путь к нему остаётся терминальный `kind="generation_offer"`, который сам по себе только
предложение (см. «Safety» выше) и требует отдельного `POST /assistant/threads/:id/generations`
(MF-1997) для реального запуска. `mode`/`scopes`, помимо фильтрации `tool_call`-меню, гейтят и сам
терминальный `generation_offer` — в `page`-режиме (или без scope `generation:propose`) `_parse_response`
отбрасывает `kind="generation_offer"` как `invalid_output`, даже если модель его всё равно вернула.

**Аудит.** Каждый исполненный `tool_call` пишет отдельное `assistant.tool_call.v1`
(`run_id`/`thread_id`/`account_id`/имя skill'а — ни аргументов, ни reasoning_content), в дополнение
к уже существующему `assistant.run.completed.v1` (`worker._log_run_completed`).

**Дефолт `mode` в `giga-assistant-worker` — временный.** `assistant_runs` (владелец MF-1997) ещё не
несёт `mode` per-run — воркер передаёт константу `"global"` (см. `worker._DEFAULT_MODE`) до того,
как колонка появится; сама оркестрация уже принимает `mode` параметром.

## Соответствие полей (канон MF-1999/MF-2014)

| Эта схема | Каноническое поле `packages/contracts/http/assistant.ts` |
| --- | --- |
| `AssistantResult.kind` | union discriminant `search_results\|clarification\|answer\|generation_offer\|generation_progress\|error` — `answer`/`clarification`/`generation_offer`/`error` здесь заведомо подмножество; `search_results`/`generation_progress` — вне периметра этого раннера (см. MF-1998/MF-2001) |
| `Citation.model_id` | реальный `models.id` (каталог = "проект", `docs/epics/neural.index.contract.md`) |
| `ErrorCode` | стабильные коды ошибок семейства (MF-1999 требует "stable error codes") |
