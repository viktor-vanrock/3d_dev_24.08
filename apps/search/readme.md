# apps/search — нейропоиск по форме модели (эпик C1 / MF-12, воркер MF-1998)

Отдельный микросервис (владелец **AI**), рантайм Python/uv — как `apps/mesh`/`apps/scout`/`apps/giga`.
НЕ живёт в `apps/api`: тяжёлые эмбеддинги/вектор-поиск — отдельный процесс, только `/health` наружу
(`docs/architecture/readme.md` § «Публичная поверхность» — тот же периметр, что mesh/giga/scout).

**Задача:** гибридный поиск (точные совпадения + full-text + вектор по тексту и по ФОРМЕ модели —
multi-view рендер геометрии) поверх versioned индекса `model-index.v1`. Спека — `docs/epics/neural.search.md`
+ `neural.index.contract.md` + `docs/architecture/neural.search.md` § «Versioned индекс» (Data,
схема MF-2003) + **`docs/contracts/model.index.v1.md` (MF-1998, consumer-сторона + ранжирование)**.

## Статус: worker/ranking/eval-ядро реализовано против применённой схемы

Схема (`search_index_jobs`/`model_embeddings`) — Data, MF-2003, уже в `origin/dev`
(`apps/api/db/migrations/20260720110000_versioned_search_index.sql`). `src/portal_search/` —
рабочий consumer поверх неё:

- `hyperpc_client.py` — bounded-клиент HYPERPC слота 4 (`/embed`, `/rerank`, `/health`), URL только
  из `HYPERPC_URL` (server env — браузер никогда не знает Tailscale-адрес, MF-1996 канон продукта).
- `render.py` — multi-view CPU-рендер STL/3MF (`trimesh` + свой numpy z-buffer, headless, не
  импортит `apps/mesh`) под `/embed`.
- `profiles.py` — идентичность HYPERPC-профилей на identity-схеме Data: текстовый профиль +
  профиль на каждый ракурс рендера (multi-view — расширение AI поверх схемы, см. контракт § 5).
- `lifecycle.py` + общая `portal_queue_lifecycle` — explicit claim/reclaim, lease generation,
  owner fencing, heartbeat, attempts, metrics и graceful drain; content `generation` остаётся
  независимым доменным fence.
- `index_lease.py` — только domain freshness: чтение hash и fenced UPSERT
  `model_embeddings.source_generation`; queue lifecycle SQL здесь больше нет.
- `worker.py` — только embedding domain helpers: один job = текст ИЛИ один ракурс, не пакет.
- `rank.py` — гибридное слияние (RRF) + rerank с graceful fallback на lexical+vector при
  недоступном HYPERPC.
- `content.py` — `PostgresModelContentProvider` читает immutable publication snapshot из
  `projects/project_revisions/project_revision_models/model_revision_files/storage_blobs`;
  удалённые legacy-колонки `models.status` и таблица `model_files` не используются.
  `index_text.py` — 1:1 порт
  `apps/api/src/models/indexText.ts::buildModelIndexText`.
- `lifecycle_worker.py` — единственный `search-worker` entrypoint. При
  `SEARCH_LIFECYCLE_ENABLED!=1` или неполной конфигурации он fail-closed и не claim'ит джобы;
  старый implicit-reclaim loop удалён.
- `tests/golden/ru_maker_queries.json` — golden-set RU maker-запросов + eval гибридного слияния.

**Что ЕЩЁ открыто** (см. `docs/contracts/model.index.v1.md` § 5 для полного списка): multi-view
наименование профилей — расширение AI, не проходило ревью Data/CTO; `packages/contracts/jobs/search.ts`
— новый шов, требует ревью **CTO**; продюсер (`apps/api/src/models/indexQueue.ts`) сейчас ставит
джобы должны использовать профиль `hyperpc/%`; подключение гибрида к `GET /models?q` — контракт
**Back**. Lifecycle и content reader проверены на disposable real PostgreSQL; живой HYPERPC/S3
и dev-runtime rollout остаются отдельным эксплуатационным gate.

**Швы (см. packages/contracts):**
- `jobs/search.ts` — api кладёт джобу «проиндексируй модель», search забирает, пишет вектор.
- `db-rows` — читает `models` (владелец Back), пишет своё вектор-хранилище (владелец AI).
- поисковый эндпоинт — `GET /models?q` (apps/api, Back) читает `model_embeddings` как `db-rows`.

**Границы:** геометрия-фичи из модели — на стыке с Mesh (конвертация); `render.py` — независимая
реализация под другую задачу (эмбеддинг, не превью), не импортит код mesh.
