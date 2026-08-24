# Шов `jobs` — api ↔ воркеры (mesh / scout / giga / search)

Развязывает control-plane (api) и воркеры полностью: общаются через **таблицу-очередь + схему
payload/result**, не через код.

Контракт джобы = (1) схема payload (что кладёт api), (2) схема result (что пишет воркер), (3) контракт
таблицы-очереди: статус `pending → running → done|failed`, идемпотентный забор, ретраи.
Файлы: `jobs/mesh.ts` (конвертация/derived), `jobs/slicer.ts` (серверный слайс MF-958),
`jobs/slicer-plate.ts` (pinned artifact + layout MF-1986), `jobs/search.ts` (индексация
эмбеддингов), `jobs/giga.ts` (AI-разбор), `jobs/feed-news.ts` (research/normalization новостей
для feed ingest).

Продюсер (api-домен) кладёт джобу; консюмер (воркер) забирает и пишет результат. Ни одна сторона не
импортит код другой.

## `feed-news.ts`: NewsCandidateV1 → NormalizedNewsV1 → FeedNewsJobOutcome (MF-2054)

`news-candidate.v1` фиксирует source records, claims и их связи, semantic labels с
confidence/evidence/model/run, community subject hint, provenance и dedup signals.
`normalized-news.v1` — самодостаточный publishable материал: plain CommonMark в `body_markdown`
плюс закрытый typed AST (`markdown|block_ref`) и allowlist блоков `image|chart|model_3d|source`.
Generic MDX/JSX, исполняемый компонент и JSON в HTML-комментарии в шов не входят.

`feed-news-job-outcome.v1` — discriminated union `ready|no_news|exact_duplicate|
quality_rejected|retryable_failure`. Runtime guards проверяют version, source/claim/evidence links,
AST→block references и соответствие candidate id во всех слоях. Golden fixture
[`fixtures/feed-news.v1.json`](fixtures/feed-news.v1.json) покрывает все терминальные ветки и
rich article со всеми четырьмя типами вставок. Downstream импортирует контракт напрямую как
`@portal/contracts/jobs/feed-news`, без импортов из `apps/*`.

### v2: раздельные роли и run provenance (MF-2060)

`feed-news-pipeline.v2` аддитивно оборачивает сохранённые material-типы v1 в четыре независимо
версионированных артефакта: `news-research-findings.v2` (local GPU researcher),
`news-composition.v2` (local GPU composer), `news-moderation.v2` (Grok) и
`news-publication.v2` (deterministic host). Каждый артефакт несёт `news-role-run.v2` с ролью,
исполнителем, prompt/model/component version, входными/выходным artifact id и временем запуска.
Общий guard проверяет всю цепочку ids, запрещает composer менять source/claim material researcher-а
и требует, чтобы findings/moderation evidence ссылались только на существующие claims/sources.

Решение Grok — закрытый union `accept|revise|reject`; только `accept` может дойти до `publish`, а
`revise|reject` требуют deterministic `withhold`. Модерация не содержит `body_markdown`, AST или
blocks. `api_feedback` отделён от editorial issues, имеет только allowlisted surfaces и literals
`disposition='advisory_only'`, `automatic_change_allowed=false`: это наблюдение для человека, не
патч API, JSON payload или tool directive. v2 guards используют exact key allowlists, поэтому
generic JSON/MDX/tool directives отвергаются. Golden fixture
[`fixtures/feed-news.v2.json`](fixtures/feed-news.v2.json) покрывает accept/publish,
revise/withhold, reject/withhold и все четыре provenance-роли. `isFeedNewsContract` читает и старый
`feed-news-job-outcome.v1`, и новую v2-цепочку без неявного downgrade.

## `slicer.ts`: доверие конфигурации (MF-1688)

`slice-trust.v1` — материал шва API → Mesh для слайсинга и последующей подписи результата. Он
обязательно содержит `account_id`, `device_id`, `profile_id`, `slice_key`, fingerprint, источник,
состояние и версию алгоритма. Exact UTF-8 строку для signer возвращает
`serializeSliceTrustMaterial`; эта строка включает `slice_key`, fingerprint и `contract_version`.
Неизвестная/старая версия отклоняется, не понижается молча.

Канонический стоковый fingerprint — SHA-256 от указанного в `slicer.ts` JSON. `agent` — факт,
поступивший от аутентифицированного Bridge; `declared` — только заявление пользователя. В v1 оба
остаются account-scoped: `cross_account_reuse=false` и `global_dedup_eligible=false`. Для
`custom`/`mismatch` возможен только индивидуальный agent fingerprint (`agent-config.v1`), а
`canonical_config_fingerprint` всегда `null`. Полное решение, ошибки и migration path:
[`docs/contracts/slice-trust.v1.md`](../../../docs/contracts/slice-trust.v1.md).

## `project-import.ts`: импорт Git/STL/3MF в резолвленный проектный граф (MF-1964)

`project-import.v1` — материал шва API (`apps/api/src/models`+`git`, продюсер) → импорт-воркер
(консюмер, статус-словарь `queued|running|done|failed` переиспользует прецедент
`apps/api/src/imports` для Cults3D). Три источника (`git`/`stl` batch/`3mf`) сходятся в один и тот же
`ResolvedProjectGraph` ([`http/models.ts`](../http/models.ts), `project-code.v1`); сырые байты не
идут в payload очереди — только непрозрачные `upload_ref(s)`/`remote_url`, STL — batch с per-item
результатом (независимый processing/retry на файл). `source.kind: "git"`
разблокируется только после приёмки quarantine-спеки
[MF-1966](mention://issue/d5e8f298-f357-4446-947c-388dcd18fae6) (allowlist/лимиты/hooks-запрет) —
этот контракт описывает только payload/result API↔воркер, не исполнение fetch. Полное решение,
идемпотентность, ошибки и migration path:
[`docs/contracts/project.import.v1.md`](../../../docs/contracts/project.import.v1.md). Fixture:
[`fixtures/project-import.v1.json`](fixtures/project-import.v1.json).

## `slicer-plate.ts`: pinned artifact + layout стола (MF-1986)

`project-slice-request.v1` — аддитивное расширение `POST /models/:id/slice`
(`slicing.route.ts`): вместо плоского `{profile_id, scale}` принимает per-instance pinned
project-as-code identity (`revision`+`configuration_id`+`configuration_digest`+
`workflow_step_id`+`artifact_id`+`artifact_sha256`, project-code.v1) вместе с раскладкой стола
(`PlateLayout`) и intent (`quality`/`supports`). API резолвит git blob сама
(`apps/api/src/models/projectSliceSource.ts`), сверяет пересчитанный sha256 — произвольный URL
от клиента запрещён. Server preflight (`apps/api/src/models/platePreflight.ts`) — финальный gate
перед созданием job, per-instance коды `collision|outside_bed|height_exceeded|clearance_failed|
unsupported_geometry`. `slice_key` расширяется на `hash(layout_digest·profile_hash·
config_fingerprint)` (`computeLayoutDigest`/`computePlateSliceKey`) — замена компонента
`model_hash` в [`data.fragmentation.md`](../../../docs/architecture/data.fragmentation.md) §1 под
layout-путём; идемпотентность — на этом ключе, не на client-side `layout_snapshot_id`.
`slice-trust.v1` (`slicer.ts` выше) — независимая ось, коды не пересекаются. Старый плоский путь
(без `layout`) продолжает работать без изменений. Явная граница v1:
`instance.source.model_id` обязан равняться `:id` из URL (один job = один проект) — комбинирование
несвязанных моделей на одной плите не входит в объём.

## `search.ts`: индексация model-index.v1 (MF-1998 поверх MF-2003)

`model-index.v1` — материал шва API (продюсер: событие «README/title/tags изменились»,
`docs/epics/neural.index.contract.md` §2, пишет `search_index_jobs`) → `apps/search` воркер
(консюмер: реализация — `apps/search/src/portal_search/index_lease.py`+`worker.py`,
lease/heartbeat/retry с фенсингом по монотонному `generation`; идемпотентность по `(model_id,
text_sha256)` — `worker.py::_index_one` сверяет `IndexRepository.get_indexed_text_sha256` ДО
платного `hyperpc.embed`, тот же hash не тратит вызов, MF-1999 §3/MF-2014). **Схема применена**:
`search_index_jobs`/`model_embeddings` — `apps/api/db/migrations/20260720110000_versioned_search_index.sql`
(Data, MF-2003, уже в `origin/dev`) — не черновик AI, типы в `search.ts` описывают реально
существующие таблицы. Результат воркер пишет напрямую в `model_embeddings` (фенсинг-UPSERT
`WHERE source_generation < excluded.source_generation`), не через API — гибридное ранжирование
(`portal_search.rank`) и итоговое подключение к `GET /models?q` — контракт Back, вне объёма этого
файла. Multi-view профили ракурсов рендера (`portal_search.profiles`) — расширение AI поверх
identity-схемы Data, НЕ проходило ревью CTO/Data (этот файл — новый в реестре швов,
`packages/contracts/package.json`: «Менять = один PR, апрув CTO»). Полное решение:
[`docs/contracts/model.index.v1.md`](../../../docs/contracts/model.index.v1.md). Fixture:
[`fixtures/model-index.v1.json`](fixtures/model-index.v1.json).

Продюсер-сторона (Back, MF-2013): `apps/api/src/models/indexQueue.ts::enqueueModelIndexJob` —
постановка/апдейт строки `search_index_jobs` под identity `('gigachat/Embeddings', 'v1', 1024)` из
`mutate.ts` (PATCH `/models/:id`) и `upload.ts` (POST `/models`), с тем же hash-гейтом
(`text_sha256` не изменился и job не `failed` → не трогаем строку) и `generation`-инкрементом
на каждой реальной постановке (в т.ч. поверх ещё не забранной `queued`-строки — фенсинг для
воркера, см. `docs/architecture/neural.search.md` § «Versioned индекс»).

## `giga.ts`: assistant-run.v1 + generation.v2 (MF-1999/MF-2014)

Обе стороны AI, но `apps/api` и `apps/giga` — разные рантаймы/деплои (см. `generations/
contract.ts` про раздельные `DATABASE_URL`), шов всё равно обязателен.

`assistant-run.v1` — продюсер `apps/api/src/assistant` (создание job на `POST .../messages`),
консюмер `apps/giga/src/giga/assistant` (`worker.py`: lease+heartbeat+attempts, не разовый claim —
HYPERPC-вызов может занять секунды-десятки секунд). `result`/`result_type` — **тот же union-тип**,
что [`http/assistant.ts`](../http/assistant.ts) (импорт `AssistantRunResult`, не копия) — api
прокидывает job result напрямую в HTTP-ответ без слоя трансляции.

`generation.v2` — формализует сегодняшнюю неявную форму строки `generations`
(`apps/giga/src/giga/worker.py`: `queued|running|done|error`): аддитивно добавляет
`contract_version` и `assistant_offer_id` (аудит-связка из `generation_offer`, null для обычного
прямого `POST /generations`). Существующие поля не меняются; публичный `GET /generations`
(`toGenerationResponse`) этим бампом не тронут — `assistant_offer_id` не публичное поле, только
внутренний job/аудит-контракт. Guard-функции + fixtures (по одному payload/result на состояние):
[`fixtures/giga.v1.json`](fixtures/giga.v1.json), тесты — [`giga.test.ts`](giga.test.ts).

`generation.v2.progress?: RunProgressSnapshot | null` (amendment MF-1999, «run/generation progress
snapshot + SSE») — тот же тип, что `http/assistant.ts::AssistantRun.progress` (импорт, не копия):
воркер публикует снапшот сюда, api копирует 1:1 без трансляции. Аддитивно, только пока
`status='running'` и джоба реально идёт через генерацию.
