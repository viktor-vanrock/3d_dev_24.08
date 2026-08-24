# `model-index.v1` — consumer-сторона versioned индекса + гибридный поиск (MF-1998)

**Статус: схема применена (Data, MF-2003), consumer-сторона (AI, этот документ) реализована и
покрыта тестами; multi-view расширение и API-подключение — открыты.**
`packages/contracts/jobs/search.ts` — новый файл в реестре швов, который по
`packages/contracts/package.json` требует ревью **CTO** перед тем, как считаться закрытым.

**Стороны:** Data (схема, уже применена), AI (consumer-воркер + гибридное ранжирование, этот
документ), Back (продюсер джобы + подключение `GET /models?q`), CTO (ревью нового шва).

## 1. Схема (Data, MF-2003, применена в `origin/dev`)

`apps/api/db/migrations/20260720110000_versioned_search_index.sql` +
`docs/architecture/neural.search.md` § «Versioned индекс» — полное решение схемы, не
пересказывается здесь целиком. Кратко, то, от чего зависит consumer-сторона:

- **`search_index_jobs`** — очередь, identity `(model_id, embedding_model, embedding_version)`,
  `status ∈ {queued, running, done, failed}`, `generation` (монотонный фенсинг-токен, растёт при
  каждой постановке в очередь, включая поверх `running` строки), `attempts`, `leased_by` +
  `leased_until` (lease с heartbeat, не голый `status='running'`).
- **`model_embeddings`** — материализованный результат, та же identity, `dim ∈ {1024, 2048}`,
  ровно одна из `embedding_1024 vector(1024)` / `embedding_2048 halfvec(2048)` заполнена
  (`halfvec`, не `vector` — pgvector не строит HNSW на `vector` с dim > 2000), `source_generation`
  — фенсинг.
- **Продюсер — `apps/api`** (Back), не `apps/search`: постановка в очередь (`INSERT ... ON
  CONFLICT (model_id, embedding_model, embedding_version) DO UPDATE SET ..., generation =
  search_index_jobs.generation + 1`) — чужая сторона шва
  (`packages/contracts/jobs/README.md`: «продюсер кладёт джобу, консюмер забирает»). AI-код
  ниже НЕ реализует enqueue.

## 2. Consumer-сторона (AI, `apps/search/src/portal_search/`, реализовано)

| Модуль | Что делает |
| --- | --- |
| `hyperpc_client.py` | Bounded-клиент HYPERPC слота 4 (`/embed`, `/rerank`, `/health`) — URL только из `HYPERPC_URL`, ограниченный retry на сеть/5xx/429 |
| `render.py` | Multi-view CPU-рендер STL/3MF (4 ракурса, общий масштаб) в PNG-байты под `/embed` — независимая реализация, не импортит `apps/mesh` |
| `profiles.py` | Идентичность HYPERPC-профилей: `hyperpc/qwen3-vl-embedding-2b` (текст) + `hyperpc/qwen3-vl-embedding-2b:viewN` (ракурсы рендера, AI-расширение — см. §5) |
| `index_lease.py` | `IndexRepository`/`EmbeddingWriter` — `claim_next`/`heartbeat`/`mark_done`/`mark_error` против `search_index_jobs`, `write` — фенсинг-UPSERT против `model_embeddings` дословно из живого теста Data |
| `worker.py` | Оркестрация: claim → embed (текст ИЛИ один конкретный ракурс, по `job.embedding_model`) → write → mark_done\|error; одна джоба = один профиль (не «весь пакет модели»), потому что так устроена identity схемы Data |
| `rank.py` | `fuse_rankings` (RRF, exact-совпадения всегда первыми) + `rerank_or_fallback` (HYPERPC `/rerank`, graceful fallback на `HyperpcError`) — независим от схемы, работает над уже полученными списками id |

### Fencing — обе стороны, не только `model_embeddings`

Воркер уходит в сетевой `/embed`-вызов БЕЗ удержания транзакции — за это время правка описания
может переставить ту же identity в очередь заново (`generation` растёт). Помимо
`model_embeddings`-UPSERT (Data, скопирован дословно), `search_index_jobs.mark_done`/`mark_error`
здесь ТОЖЕ фенсятся по `generation`, которую вернул `claim_next`: если она успела уйти вперёд
(кто-то переставил джобу заново, пока мы работали), поздняя попытка тихо не трогает строку —
свежая постановка уже сделала её `queued` и готовой к повторному claim. Это расширение AI поверх
того, что Data явно зафиксировал только для `model_embeddings` — тот же принцип, применённый
последовательно ко второй стороне гонки.

### Один job = один профиль

Identity `(model_id, embedding_model, embedding_version)` — один ряд `model_embeddings` = один
вектор. Джоба на текстовый профиль и джоба на профиль конкретного ракурса — РАЗНЫЕ строки
`search_index_jobs`, забираются и обрабатываются независимо (не «рендерь все 4 ракурса и текст
одним claim»). `worker.process_one` диспетчерит по `job.embedding_model`
(`profiles.is_view_profile`) — это следствие того, как построена схема Data, не выбор AI ради
удобства.

## 3. Гибридное ранжирование (`rank.py`, не зависит от схемы БД)

`neural.search.md` § «Гибридный поиск»: не заменять full-text вектором, комбинировать.
`fuse_rankings` — чистая функция слияния трёх уже полученных списков id:

- `exact_ids` — точные совпадения title/brand/tag (SQL за Back);
- `lexical_ranked_ids` — полнотекст;
- `vector_ranked_ids` — pgvector/halfvec ANN по эмбеддингу запроса (через `hyperpc_client.embed`,
  профиль `model_embeddings_profile_idx` — канареечное чтение активного профиля, Back).

**Гарантия "точные совпадения не проседают"** — структурная: `exact_ids` всегда первые,
RRF управляет только остальным. **Fallback при недоступном HYPERPC — обязательный путь**:
`rerank_or_fallback` ловит `HyperpcError`/`HyperpcTimeout`, возвращает fused-порядок без
изменений — ответ остаётся lexical+vector, не 500.

Golden-set (`apps/search/tests/golden/ru_maker_queries.json`, 7 RU maker-запросов) + eval
(`test_hybrid_relevance_eval.py`) — TF-косинус прокси вместо реального HYPERPC (как
`apps/giga/tests/golden/relevance_scoring.py` для GigaChat), проверяют recall@1 и exact-brand
guarantee. Метод заменяется на реальный `/embed` при живом слоте без изменения формата golden-set.

## 4. Идемпотентность backfill/update-после-edit

Обеспечена ПОЛНОСТЬЮ на стороне Data (`search_index_jobs` unique identity + `ON CONFLICT DO
UPDATE`) — повторный backfill по уже проиндексированным моделям не плодит дублей; правка
описания увеличивает `generation` и ставит `queued` заново поверх той же строки. AI-consumer
ничего не решает здесь дополнительно — просто корректно фенсится по `generation`, которую видит.

## 5. Открыто

1. **Multi-view наименование профилей** (`profiles.py`: `hyperpc/qwen3-vl-embedding-2b:viewN`)
   — расширение AI поверх схемы Data, не проходило ревью. Схема Data не проектировала явно под
   несколько геометрических ракурсов — identity-триплет вмещает их без изменения DDL, но само
   соглашение об именовании — решение AI, зафиксированное здесь впервые.
2. **`jobs/search.ts`** — новый файл реестра швов, ревью **CTO**.
3. **~~`ModelContentProvider` Postgres-адаптер~~ — закрыто (MF-2022).** `content.py::
   PostgresModelContentProvider` читает `models`(title/description/status='ready')/`model_tags`+
   `tags`(`order by t.name`)/`model_files`(`role='canonical_3mf'`) и собирает текст через
   `index_text.build_model_index_text` (1:1 порт `apps/api/src/models/indexText.ts`). Видимость —
   `status='ready'`, тот же принцип, что `giga/assistant/evidence.py`. `bootstrap.py::main` —
   недостающий `__main__`/entrypoint, собирает `PostgresIndexRepository`/`PostgresEmbeddingWriter`/
   `PostgresModelContentProvider` из `DATABASE_URL`+`S3_*` и передаёт в `worker.run_loop`;
   `pyproject.toml` `search-worker` теперь указывает на `portal_search.bootstrap:main`, не на
   голый `run_loop` (который без аргументов всегда простаивал — MF-2021 живая находка). Протестировано
   на фейковом connection/cursor/S3-клиенте (`tests/test_content.py`, `tests/test_bootstrap.py`),
   живого прогона против Postgres/S3 нет (см. п.5).
4. **`GET /models?q` гибридное подключение + backfill enqueue** — контракт **Back**
   (`apps/search/readme.md` § «Границы»). Этот документ не решает эндпоинт/SQL лексического+ANN
   каналов и не пишет `search_index_jobs` (продюсер — не AI).
5. **Живой прогон против HYPERPC** — нет сетевого доступа к Tailscale-адресу из окружения
   реализации; `hyperpc_client.py` протестирован на `httpx.MockTransport`, `index_lease.py`/
   `worker.py` — на фейковом connection/cursor, не против живого Postgres/HYPERPC.
