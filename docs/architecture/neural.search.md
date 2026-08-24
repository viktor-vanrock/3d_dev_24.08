# Контракт эмбеддингов нейропоиска

## Зафиксированное решение

`apps/giga` использует GigaChat API с моделью `Embeddings`. Контракт ответа
`POST /embed`:

- `embedding` — L2-нормированный массив чисел;
- `model` — `Embeddings`;
- `dim` — `1024`;
- фактическая длина массива обязана быть `1024`, иначе сервис отвечает ошибкой
  контракта и не возвращает вектор другой размерности.
- сетевой вызов использует timeout `30` секунд, до `3` повторов для
  `429/5xx` и transport errors, с exponential backoff от `0.5` секунды;
  параметры задаются в `apps/giga/src/giga/gigachat_client.py` и действуют
  также для генеративных вызовов GigaChat.

Размерность `1024` — общий контракт с `apps/api`/Data: профиль
`embedding_model='gigachat/Embeddings'` в таблице `model_embeddings` хранит
вектор в колонке `embedding_1024 vector(1024)` с HNSW-индексом той же
размерности (`apps/api/db/migrations/20260720110000_versioned_search_index.sql`,
MF-2003 — см. § «Versioned индекс» ниже; исходная однопрофильная колонка
`models.embedding` из `20260711210000_models_embedding_pgvector.sql` этой
миграцией удалена как непрочитанная кодом на тот момент).

Источник решения — реализация `apps/giga/src/giga/search/embed.py`, commit
`ff52f74` (MF-348, автор — AI, 11.07.2026); подтверждение в issue MF-1015
зафиксировано 13.07.2026. Смена модели или N внутри ОДНОГО профиля по-прежнему
требует одновременно обновить этот документ, код-контракт и пересчитать
существующие векторы того профиля; смена НА ДРУГОЙ провайдер/размерность (как
HYPERPC ниже) больше не требует останавливать существующий профиль — см. §
«Versioned индекс».

## Versioned индекс: параллельный rollout 1024 (GigaChat) / 2048 (HYPERPC)

HYPERPC-слот 4 (`docs/process/hyperpc.local.llm.md`, `POST /embed` на
`100.74.48.83:8189`) отдаёт `dim=2048` моделью Qwen3-VL-Embedding-2B —
кандидат на замену/дополнение GigaChat Embeddings, но другой размерности.
pgvector не даёт `alter type vector(1024) -> vector(2048)` вживую без
пересчёта всех векторов, а прямое переключение колонки картой MF-2003 прямо
запрещено — нужен параллельный rollout без простоя.

**Схема** (`apps/api/db/migrations/20260720110000_versioned_search_index.sql`):

- `model_embeddings(model_id, embedding_model, embedding_version, dim, embedding_1024, embedding_2048, text_sha256, index_status, source_generation, indexed_at)`
  — материализованный результат. Одна строка = один профиль (`embedding_model`
  + `embedding_version`) для одной модели; у одной модели одновременно может
  существовать НЕСКОЛЬКО строк — разных профилей — это и есть параллельность.
  Ровно одна из `embedding_1024`/`embedding_2048` заполнена (constraint
  `model_embeddings_dim_column`), партиционировано по `dim`, а не по строке.
- `search_index_jobs(model_id, embedding_model, embedding_version, dim, text_sha256, status, generation, attempts, leased_by, leased_until)`
  — очередь пересчёта, одна строка на identity (повторная постановка в очередь
  обновляет ту же строку, дебаунс — natural).

**Почему `embedding_2048` — `halfvec(2048)`, не `vector(2048)`.** Проверено
живьём при подготовке этой миграции: pgvector (0.8.5, sandbox-db на этой же
БД) отказывает строить HNSW/ivfflat на `vector` с dim > 2000
(`column cannot have more than 2000 dimensions for hnsw index`, SQLSTATE
54000). 2048 в этот потолок не помещается. `halfvec` (тот же вектор, fp16
вместо fp32 на элемент) поднимает потолок HNSW до 4000 измерений — единственный
способ проиндексировать этот профиль без урезания размерности на стороне
HYPERPC (Matryoshka truncation для Qwen3-VL-Embedding-2B никем не
подтверждена, в отличие от GigaEmbeddings/Qwen3-Embedding текстовых моделей
из docs/epics/neural.search.md). Любой будущий провайдер/эндпоинт, кто пишет
в `embedding_2048`, обязан приводить вектор к `halfvec(2048)` на вставке
(`::halfvec(2048)`) — точность half-precision не является дополнительной
потерей относительно того, что и так теряет приближённый HNSW-поиск.

**Фенсинг гонки записи** (карта MF-2003: «старый job не может перезаписать
новый текст»). Воркер лизингует строку `search_index_jobs`, уходит в сетевой
`/embed`-вызов БЕЗ удержания транзакции — за это время правка описания может
поставить ту же identity в очередь заново с более свежим текстом. Запись
результата обязана быть условной по монотонному `generation`:

```sql
insert into model_embeddings (model_id, embedding_model, embedding_version, dim, embedding_1024, text_sha256, source_generation)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (model_id, embedding_model, embedding_version) do update
  set embedding_1024 = excluded.embedding_1024, text_sha256 = excluded.text_sha256,
      source_generation = excluded.source_generation, indexed_at = now(), updated_at = now()
  where model_embeddings.source_generation < excluded.source_generation
```

Опоздавшая (меньший `generation`) запись просто не проходит `WHERE` — 0 строк
изменено, воркер не считает это ошибкой (работа была вытеснена более свежей
постановкой, не провалена). Живой тест инварианта (гонка воспроизведена явно,
не таймингом) —
`apps/api/src/db/versioned-search-index.migration.test.ts`.

**Backfill** (первое включение профиля или смена модели): по каждой модели
каталога вычислить `buildModelIndexText` (`apps/api/src/models/indexText.ts`,
контракт зафиксирован `docs/epics/neural.index.contract.md` §0) → `sha256` →
поставить `search_index_jobs` строку с этим профилем (`on conflict do
update`, идемпотентно — повторный прогон backfill по уже проиндексированным
моделям не плодит дублей и не тратит лишний вызов `/embed`, если
`text_sha256` не изменился). Инкрементальный реиндекс — тот же путь, просто
триггер другой (правка README/описания/тегов, `docs/epics/neural.index.contract.md`
§2), а не разовый обход каталога.

**Канареечный rollout и переключение поиска.** Пока у профиля `hyperpc/...`
не для всех моделей есть `model_embeddings`-строка со `index_status='ready'`,
`GET /models?q=` (MF-1998) обязан продолжать читать активный профиль
(`gigachat/Embeddings`) — партиционированный по `embedding_model,
embedding_version` индекс `model_embeddings_profile_idx` даёт дешёвый запрос
«сколько моделей уже готовы под кандидатным профилем» без похода в
`search_index_jobs`. Переключение активного профиля — смена того, ЧТО ЧИТАЕТ
запрос (константа/конфиг в hybrid search worker), не миграция данных: старый
профиль продолжает существовать нетронутым, пока явно не удалён.

**MF-2022 живая находка — прямое переключение вместо канареечного rollout.**
Канареечный план выше подразумевает, что `gigachat/Embeddings` реально
обслуживает трафик, пока `hyperpc/...` бэкафиллится рядом. На практике
GigaChat-креды на VDS пусты и в прод, и на dev (обе среды) — профиль
`gigachat/Embeddings` НИКОГДА не обслуживал ни одного реального запроса,
защищать нечего. `apps/api/src/models/indexQueue.ts` (Back) переключён
напрямую на `hyperpc/qwen3-vl-embedding-2b`/dim=2048 без промежуточного
параллельного состояния — canary-механизм схемы (обе колонки/оба профиля
одновременно) остаётся рабочим и доступным для ЛЮБОГО будущего переключения
профиля, где у активного профиля действительно есть живой трафик для защиты.
Query-side эмбеддинг запроса (`apps/api/src/models/searchEmbedClient.ts`)
пока не переключён — зовёт GigaChat через `apps/giga` (AI-владение), поэтому
гибридный векторный поиск структурно не может включиться (dim/пространство
эмбеддингов не совпадают с write-профилем), каталог честно остаётся на
lexical до отдельной карты с HYPERPC-based query-эмбеддером.

**Rollback профиля** (отмена HYPERPC-кандидата, если качество/бюджет не
подошли): `delete from model_embeddings where embedding_model = 'hyperpc/...'`
+ соответствующие `search_index_jobs`; активный профиль (`gigachat/...`) не
затрагивается — поиск не деградирует ни на секунду, потому что никогда не
зависел от кандидата. Откат САМОЙ миграции (`dbmate rollback`) восстанавливает
исходную `models.embedding vector(1024)`/`models_embedding_hnsw_idx` из
`20260711210000` и не трогает `pg_trgm`-индексы `models_title_trgm_idx`/
`models_description_trgm_idx` (`20260709000001`) — лексический поиск не
теряется ни при каком сценарии, живой тест на это есть в
`versioned-search-index.migration.test.ts`.

**Размер индекса (измерено).** HNSW-граф — доминирующая часть размера при
малом N (фиксированные накладные расходы структуры), на sandbox-копии
`portal_dev` (111 синтетических строк на профиль) — по ~272 KB на каждый из
двух partial-индексов. Асимптотика по документации pgvector: на строку —
`4 * m` байт связей графа (`m=16` по умолчанию) плюс сами данные вектора
(`dim * 4` байта для `vector`, `dim * 2` байта для `halfvec`) — то есть
профиль 1024 (`vector`) кладёт на строку заметно больше данных вектора
(~4 КБ), чем профиль 2048 (`halfvec`, ~4 КБ тоже, несмотря на вдвое большую
размерность, ровно из-за fp16). На масштабе каталога (десятки-сотни тысяч
моделей, не миллионы — `docs/epics/neural.search.md` §«Хранилище векторов»)
оба индекса остаются в пределах одного Postgres-инстанса без доп. инфры.

## Граница сервиса и delivery

Giga не публикуется через nginx. HTTP-поверхность dev запускается unit-файлом
`apps/giga/deploy/portal.giga-http.service` на `127.0.0.1:3102`; endpoint
доступен сервис-сервису по приватной границе, а наружный `api.dev.3mf.tech`
остаётся BFF и не обязан иметь маршрут `POST /embed`. Скрипт
`deploy/portal.deploy-dev.sh` учитывает `apps/giga` отдельным delivery surface:
после `uv sync` он перезапускает unit, проверяет `GET /health` и записывает
`giga.sha` только после успешной проверки.
