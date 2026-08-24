# Шов `http` — web ↔ api

Типы запрос/ответ по каждому api-домену: `http/<domain>.ts` (например `http/community.ts`,
`http/devices.ts`). Продюсер — владелец api-домена (§2 карты), консюмер — `apps/web`.

**Зачем:** сейчас web пишет `fetch` руками, контракт неявный → тихие рассинхроны. Тип здесь = единый
источник формы. api валидирует по нему на выходе, web типизирует по нему запрос.

**Наполнение** — по мере переезда доменов на явный контракт (карты на владельцев доменов). Начать с
активных: `community`, `feed`, `devices`, `ideas`, `models`, `catalog`.

Текущие версии:

- `openapi.v1.json` — сгенерированный из фактического Nest AppModule контракт всех HTTP routes.
  `apps/api` обновляет его командой `openapi:generate`; CI запускает `openapi:check`, поэтому DTO,
  controller decorators и клиентский контракт не могут разойтись незаметно. Это drift-гейт: doc
  обязан равняться собственной закоммиченной копии.

- `openapi-conformance.test.ts` — гейт соответствия сгенерированного `openapi.v1.json`
  **source of truth** в этом пакете (не только собственной копии): `ApiErrorDto.code` enum ровно
  равен `API_ERROR_CODES` из `error-envelope.ts`, форма envelope совпадает с `ApiError`/
  `ApiErrorEnvelope`, и КАЖДЫЙ объявленный 4xx/5xx ответ ссылается на `ApiErrorEnvelopeDto`
  (spec http-error-contract). Запускается в CI через `pnpm test` (turbo → `@portal/contracts`).

- `apps/web/src/api/generated/openapi.ts` — сгенерированные TypeScript-типы `paths`, `operations`
  и `components` для frontend. Обновление: `pnpm --filter @portal/web api:types:generate`; drift-гейт:
  `pnpm --filter @portal/web api:types:check`. Endpoint-specific DTO сохраняют точную форму. Для
  каждого JSON endpoint опубликована конкретная request/response schema; универсальный
  `ApiJsonValue` запрещён conformance-гейтом. Отдельный lint-гейт запрещает
  `Promise<unknown>` в controllers и public ports.

- `error-envelope.ts` — `api-error.v1`: единый безопасный error envelope Portal API со
  стабильным versioned `code`, пользовательским `message` и correlation `requestId`.
  Legacy-формы ошибок намеренно не входят в контракт; клиенты используют этот тип и OpenAPI.

- `community.ts` — `community-antiabuse.v1`: TL0, идемпотентность создания, неанонимные голоса,
  rate-limit и observability. Полное решение и JSON-fixtures:
  [`docs/contracts/community.antiabuse.v1.md`](../../../docs/contracts/community.antiabuse.v1.md).
- `devices.ts` — `firmware-pilot.v1`: Back публикует для **точной модели** поле
  `pilot_status` в `GET /printers/:slug`; Front только читает его для виджета парка/каталога.
  Владельцем факта остаётся Fleet: `fleet` может подтвердить этап лишь обезличенным evidence,
  а Back не выводит его из паспорта, дедлайна или похожей модели. Допустимы только стадии
  `not_started`, `building`, `burn_in`, `ready`, `stopped`; `ready` не заменяет
  `firmware_ready` модели.

  `status: "no_data"` — явное отсутствие факта. Для `status: "reported"` Back выставляет
  `freshness: "stale"`, когда `now - updated_at > 24h`; Front показывает «данные устарели» и
  не называет такой этап текущим. Поле аддитивно: пока producer разворачивается, отсутствие
  `pilot_status` трактуется как `no_data`, затем поле становится обязательным.

  Это read-only контракт: отдельного idempotency key нет. Событие наблюдаемости
  `FirmwarePilotStatusUpdatedEvent` дедуплируется по `(model_id, updated_at)`; повтор с иным
  payload — producer-conflict и не заменяет факт. Чтение публичное, запись — только Fleet через
  Back; `401/403` относятся только к write-path и не раскрывают запись. В payload, событиях и
  логах запрещены LAN URL/IP, serial, токены, credentials и команды. Fixture:
  [`fixtures/firmware-pilot.v1.json`](fixtures/firmware-pilot.v1.json).
- `printers.ts` — `printers.catalog.v1`: публичный cursor-контракт `GET /printers` для
  Data → Front. Владелец канонических данных — Data (`printers`); Front только читает
  `items/has_more/next_cursor`, не декодируя cursor. Полное решение, ошибки, наблюдаемость и
  миграция fixture/offset: [`docs/contracts/printers.catalog.v1.md`](../../../docs/contracts/printers.catalog.v1.md).
- `models.ts` — `project-code.v1`: `apps/api/src/models`+`git` (Back) → `apps/web/src/market`
  (Front). Резолвленный проектный граф `portal.project.yaml` (нормативный канон
  `docs/architecture/project.manifest.md`; JSON Schema:
  [`project.manifest.v1.schema.json`](project.manifest.v1.schema.json), `$id`
  `https://schemas.3mf.tech/project/v1`), CAS-запись через `base_head_sha`/`head_sha`, точные
  diagnostics (`json_path`/`yaml_line`/`code`, lower_snake_case) и публичные bounded tree/readme/
  history без `author_email`. Заменяет локальные типы `apps/web/src/market/models.types.ts`
  (`RepoTreeResult`, `RepoHistoryResult`, `RepoHistoryCommit`). Полное решение, ошибки,
  наблюдаемость и migration path:
  [`docs/contracts/project.code.v1.md`](../../../docs/contracts/project.code.v1.md). Fixtures:
  [`fixtures/project.manifest.v1.minimal.json`](fixtures/project.manifest.v1.minimal.json),
  [`fixtures/project.manifest.v1.lerobotdepot.json`](fixtures/project.manifest.v1.lerobotdepot.json).
- `assistant.ts` — `assistant.v1`: `apps/api/src/assistant` (owner AI, CODEOWNERS) → консюмеры.
  CRUD-формы приватных threads/messages/runs (idempotent `client_request_id`, cursor-пагинация,
  auth 401/чужой thread 404, подтверждение `generation_offer` через существующую очередь
  `/generations`), `queue_position`/`eta_seconds` на run'е (живые, из БД — переживают закрытие
  вкладки) и SSE-контракт `GET /assistant/runs/:id/events` (`assistant.delta`/
  `assistant.completed`/`assistant.error`, идемпотентный `seq`/`Last-Event-ID`, снапшот на свежем
  подключении) — плюс полный versioned result union (`search_results|clarification|answer|
  generation_offer|generation_progress|error`, дискриминант `kind` — реальное поле, которое пишет
  `apps/giga/src/giga/assistant/schemas.py`, не `type` из первоначального текста решения MF-1999).
  `jobs/giga.ts::assistant-run.v1` импортирует этот union, не копирует. Guard-функции
  (`isAssistantRunResult` и по варианту) + fixture на каждый вариант + idempotency-conflict:
  [`fixtures/assistant.v1.json`](fixtures/assistant.v1.json), тесты — [`assistant.test.ts`](assistant.test.ts).
  Сегодняшний продюсер (`giga.assistant-run.v1`) — заведомое подмножество из четырёх вариантов
  (`answer|clarification|generation_offer|error`), см. `docs/contracts/assistant.run.v1.md`.
  **Amendment** (MF-1999, «run/generation progress snapshot + SSE»): `AssistantRun.progress?:
  RunProgressSnapshot | null` — позиция ВНУТРИ генерации (`phase: queued|loading|draft|geometry|
  validation|export`, `progress 0..100|null`, `eta_seconds`, `estimate_updated_at`), осмысленна
  только при `status="running"` и только для run'ов, реально идущих через генерацию — `null` для
  clarify/answer. Только сервер публикует значения, фронт не интерполирует между снапшотами.
  `jobs/giga.ts::generation.v2` получает тот же тип аддитивно в `result.progress` (импорт, не
  копия) — это контракт формы, реального продюсера (TRELLIS-джоба, MF-2001) на момент этого
  амендмента ещё нет, SSE-эндпоинт/каталог событий, уже отгруженный MF-1997 (`GET
  /assistant/runs/:id/events`), этим не переделывается — только аддитивная форма снапшота. Guard
  `isRunProgressSnapshot` + fixtures на каждую фазу и on/off `progress`. **Правка MF-2014**
  (второй проход Contract Architect): `queue_position` убран из `RunProgressSnapshot` — на
  `AssistantRun` это уже есть как read-time позиция во внешней очереди (`apps/api/src/assistant/
  queue.ts`), второй источник тех же данных внутри снапшота рисковал разойтись с ним, когда
  продюсер прогресса начнёт писать оба поля отдельными путями. `eta_seconds` внутри снапшота не
  дубликат — это гранулярная оценка "сколько осталось" уже идущему пайплайну (реально пишет
  `generations.eta_seconds`, MF-2001), а верхнеуровневый `eta_seconds` — только пока
  `status="queued"`; пересечения по времени нет.
- `search.ts` — `model-search.v1`: `apps/api/src/models` (Back) → `apps/web` (Front). Расширяет
  существующий `GET /models?q=...` — тот же эндпоинт, ILIKE → гибрид full-text+вектор под капотом
  (`docs/epics/neural.index.contract.md` §4). Запрос — опциональный `?search_mode=hybrid|lexical`;
  ответ аддитивно получает `request_id`/`search_mode_used`/`degraded?` — `degraded:true`, когда
  embedding-бэкенд (`apps/giga /embed`) недоступен и API тихо упал на lexical (это не ошибка).
  Приватность: сырой score и имя embedding-модели наружу не публикуются. Решение — карточка
  MF-1999 (доска `tasks.3mf.tech`), комментарий «Contract decision», раздел §1; продуктовый
  фон — [`docs/epics/neural.index.contract.md`](../../../docs/epics/neural.index.contract.md) §4,
  [`docs/architecture/neural.search.md`](../../../docs/architecture/neural.search.md).
  Fixture: [`fixtures/model-search.v1.json`](fixtures/model-search.v1.json) (hybrid/
  lexical-degraded/empty).
