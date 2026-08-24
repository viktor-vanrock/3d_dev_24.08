# EPIC: 3MF как единственный формат хранения и выдачи

**Статус:** предложение, требует решений от Валерия (см. «Открытые вопросы»)
**Оценка:** большая задача (multi-week), разбита на фазы ниже

**См. также:** [`docs/epics/formats.policy.md`](./formats.policy.md) (MF-21) —
надстройка над этим документом: whitelist приёма (расширения/MIME/magic-байты),
матрица «формат→извлекаем/теряем» (подтверждена спайком `trimesh` в
`apps/mesh/tests/test_format_spike.py`), таксономия ошибок upload,
XXE/decompression-bomb для zip/OPC-контейнеров.
Сводный статус конвертера по четырём основным форматам — в
[converter.status.md](converter.status.md).

## Проблема и цель

Пользователь загружает модель в любом формате (STL/OBJ/STEP/…), мы конвертируем и оптимизируем на сервере, **храним и отдаём пользователям только 3MF**. Задача — не просто «сконвертировать», а понять, какой профиль 3MF брать: спецификация модульная, часть расширений даёт реальные возможности (цвет, мультиматериал, защита IP), часть — почти не поддерживается инструментами. Взять «самое продвинутое» бездумно — получить файлы, которые никто не откроет.

## Формат 3MF: что это и из чего состоит

**3MF — теперь официальный стандарт ISO/IEC 25422:2025** (был отраслевой спекой 3MF Consortium — 16 steering-членов: Autodesk, Dassault, HP, Microsoft, Prusa Research, Stratasys, UltiMaker и др., 20+ associate). Формат — XML+ZIP (OPC-пакет), специально под аддитивное производство. [3mf.io](https://3mf.io/) · [спека](https://3mf.io/spec/) · [ISO-новость](https://www.metal-am.com/3mf-file-format-officially-becomes-iso-additive-manufacturing-standard/)

**Core Specification** — база: геометрия мешей, структура пакета, минимальные метаданные. Сам по себе core — это упрощённый аналог STL с чуть лучшей организацией.

Ключевое отличие от STL: **модульность через независимо версионируемые расширения** — можно поддержать ровно то, что нужно продукту, без веса остального. На июль-2026 (проверено на [официальной странице спек](https://3mf.io/spec/), актуальность подтверждена практическим разбором [«Into the 3MF Specification Wilderness»](https://stevescargall.com/blog/2026/02/into-the-3mf-specification-wilderness-reading-1000-pages-of-specifications/)) — **все 8 официальных расширений уже в финальных версиях**:

| Расширение | Версия | Что даёт | Реальная поддержка в слайсерах |
|---|---|---|---|
| **Materials and Properties** | v1.2.1 | Цвет, мультиматериал, per-triangle свойства | Высокая — Bambu Studio/OrcaSlicer/PrusaSlicer читают штатно |
| **Production** | v1.1.2 | UUID объектов, сборки, multi-part build-plate, атрибуты build-секции | Высокая, но **не универсальная** — часть стороннего софта не открывает 3MF от Bambu Studio именно из-за Production-расширения; PrusaSlicer доросла лишь в марте 2024 |
| **Slice** | v1.0.2 | Уже нарезанные слои внутри пакета (нулевая пере-нарезка) | Средняя — то, что позволяет Bambu Studio сохранять «печатные проекты» |
| **Beam Lattice** | v1.2.0 | Параметрические лёгкие решётчатые структуры (граф узлов+диаметр луча) | Низкая, нишевая (инженерные/промышленные слайсеры) |
| **Boolean Operations** | v1.1.1 | Булевы операции над геометрией (CSG) | Низкая-средняя, растёт |
| **Displacement** | v1.0.0 | Текстурированные сетки через displacement mapping | Низкая, новое |
| **Secure Content** | v1.0.2 | Шифрование содержимого — защита IP автора при легальной печати | Низкая в потребительских слайсерах, но концептуально совпадает с нашей задачей защиты авторов (см. `docs/product/features.md`, «Антипиратство» в v2) |
| **Volumetric** | **v1.0.0** (финализировано ~ноя-2025, до этого был драфт v0.8.0) | Воксельные/неявные (SDF) данные — плотность, микроструктура, процедурный объём | **Самая свежая и наименее поддержанная** — по сути ещё экспериментальная в плане инструментов, хотя формально уже v1.0 |

Источники по всем расширениям: [официальный список](https://3mf.io/spec/), GitHub `3MFConsortium/spec_*`.

### Наш целевой профиль (рекомендация)

Не «взять всё» — взять то, что даёт реальную ценность для UX + то, что делает нас «продвинутыми» без потери совместимости:

- **Обязательно (MVP):** Core + **Materials and Properties** (цвет/материал — без этого модель выглядит бесцветной болванкой) + **Production** (сборки из нескольких деталей — у нас уже есть multipart-модели, см. демо-прототип `3dmake/DEMO.md`, «nier2b=26 деталей»).
- **v2, наш дифференциатор:** **Secure Content** — единственное расширение, которое прямо решает продуктовую задачу защиты авторов (`docs/product/vision.md`, RU-дифференциал; `docs/product/features.md`, «Антипиратство»). Мало кто в потребительском сегменте это делает — реальный повод для громкой фичи «на 3MF от нас нельзя утащить и распечатать без покупки», но проверить перед обещаниями — насколько сами слайсеры соблюдают шифрование (без поддержки конкретного слайсера файл просто не откроется, это не всегда плюс).
- **«Продвинутое, может даже экспериментальное»** — это **Volumetric** (v1.0, только что финализировано, почти никто не использует). Кандидат на **бренд-фичу «мы одни из первых в мире с Volumetric 3MF»**, но с открытыми глазами: инструментов, которые это прочитают, почти нет — сейчас это скорее «задел на будущее» / маркетинговый рычаг, чем практическая польза для среднего юзера. Не блокировать MVP на этом.
- **Не брать сейчас:** Beam Lattice, Boolean Operations, Displacement, Slice — нишевые, либо мы сами не производим такую геометрию (Slice — это была бы уже «мы = слайсер», отдельная большая история).

## Архитектура конвейера конвертации

```
Пользователь → загрузка (любой формат: STL/OBJ/STEP/3MF/…)
   → apps/api принимает файл, кладёт «как есть» во временное хранилище
   → job в PostgreSQL-очередь (см. docs/architecture/readme.md) → apps/mesh забирает
   → apps/mesh: разбор исходника → нормализация/оптимизация геометрии → упаковка в 3MF
   → готовый .3mf → S3-бакет `3mf` (cloud.ru)
   → apps/api отдаёt пользователям ТОЛЬКО .3mf (оригинал не раздаётся)
```

### Инструменты конвертации (Python, `apps/mesh`)

- **`trimesh`** (уже зависимость `apps/mesh`) — читает/пишет 3MF (`trimesh.exchange.threemf`, `load_3MF`/`export_3MF`), но документация не раскрывает поддержку расширений — по устройству библиотеки (геометрия прежде всего) поддержка Materials/Production, скорее всего, минимальна или отсутствует. Годится для этапа «прочитать входной STL/OBJ, децимировать, нормализовать» (уже используется в `convert.py`).
- **`lib3mf`** — официальная референс-реализация от 3MF Consortium, есть Python-биндинги (пакеты `lib3mf`/`py-lib3mf` на PyPI, релиз май-2026), кросс-платформенная, поддерживает валидацию и **расширения по спецификации**. [GitHub](https://github.com/3MFConsortium/lib3mf) · [PyPI](https://pypi.org/project/lib3mf/) · [readthedocs](https://lib3mf.readthedocs.io/).
- **Рекомендуемое разделение труда:** `trimesh` — загрузка входного формата + геометрическая обработка (децимация/нормализация/ориентация, как уже сделано в `convert.py`); **`lib3mf`** — финальная упаковка в 3MF с нужными расширениями (материалы/сборки/шифрование). Нужен пилотный спайк — проверить на реальном файле, что `lib3mf` действительно кладёт Materials-расширение и его читает Bambu Studio/OrcaSlicer.

### Формат для STEP (CAD-источники)

STEP (инженерный формат) — не мешевый, а B-rep (граничное представление). `trimesh` его не парсит нативно — понадобится либо конвертация через `python-occ`/`FreeCAD`-headless в мешевый промежуточный формат, либо ограничить приём STEP на MVP (STL/OBJ/3MF — сразу, STEP — v2). Пометить как открытый вопрос ниже.

## Открытые вопросы (нужно решение Валерия)

1. ~~**Хранить ли оригинал загрузки**~~ — **РЕШЕНО (Валерий, 2026-07-05, MF-336): храним.** Глобальная чистка — позже отдельным решением, lifecycle-правила на удаление пока не включаем. Приоритет — отработать сам алгоритм «юзер залил STL → на скачивание оптимизированный 3MF»; какой именно профиль 3MF — см. «Наш целевой профиль» выше + спайк lib3mf в Фазе 1.
2. **Secure Content всерьёз или нет** — это реальная инженерная работа (ключи, управление доступом при печати) ради фичи, которую сегодня мало кто из слайсеров уважает. Громкий маркетинг vs риск «не работает у большинства юзеров».
3. **STEP на старте или в v2** — см. выше, отдельная конвертационная цепочка.
4. **Volumetric — просто заявить в позиционировании сейчас, или ждать реальной пользы** (когда слайсеры начнут поддерживать)?

## Модель данных — `models`/`model_files` (Фаза 1, MF-336 — спроектировано 2026-07-05)

Схема следует ограничениям `docs/epics/domain.model.md` § «Обязательные ограничения для Фазы 1»: `text + check` вместо Postgres-enum, `craft` — slug будущего справочника `crafts` (пока единственное значение), никаких `print_*`/`stl_*`-имён и принтер-специфичных колонок в `models` (связь со станком — через будущие `makes`/задания на печать, не в ядре модели). DDL — идемпотентный `create table if not exists` в `apps/api/src/db/schema.ts` (временная замена настоящего инструмента миграций, см. `docs/issues/007.database.design.md`).

```sql
create table models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  title text not null,
  source_format text not null check (source_format in ('stl', 'step', '3mf')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'pending', 'processing', 'ready', 'failed')),
  craft text not null default '3d_printing',  -- slug будущего справочника crafts
  bbox jsonb,                                  -- габариты, формат нейтрален к ремеслу
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index models_owner_idx on models (owner_id, created_at desc);
-- частичный индекс — быстрая выборка незавершённых конвертаций (очередь/мониторинг)
create index models_status_pending_idx on models (status)
  where status in ('uploaded', 'pending', 'processing');

create table model_files (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models(id) on delete cascade,
  role text not null check (role in ('source', 'canonical_3mf', 'preview')),
  s3_key text not null unique,   -- 'models/{model_id}/{role}.{ext}' в бакете `3mf`
  size_bytes bigint not null,
  checksum bytea not null,       -- sha256
  created_at timestamptz not null default now()
);
create index model_files_model_idx on model_files (model_id);
```

**`source_format`/`role`/`status` расширяемы одной миграцией** (`dxf`/`svg`/`obj` в форматы; `gcode`/`drawing` в роли) — принцип «справочник, не enum» из `domain.model.md`. **`checksum` sha256 `bytea`** — совпадает с конвенцией `identifier_hash` в `user_identities` (тот же тип для хешей). **`owner_id`/`model_id` без `on delete cascade` на `models.owner_id`** (в отличие от `model_files.model_id`, где cascade обязателен — файлы не должны пережить модель) — сценарий удаления юзера с его моделями пока открыт (см. «Открытые вопросы» в `docs/issues/007.database.design.md` про soft-delete и 152-ФЗ), решать вместе с этим вопросом отдельно, не в этой миграции.

## Модель данных — теги, голоса, счётчики каталога (Этап 3, MF-462 — спроектировано 2026-07-05)

Расширение схемы под маркет моделей, идёт параллельно с дизайном маркета (MF-461). Узкая пара `model_tags`/`model_votes` — без полиморфного `(subject_type, subject_id)` из `domain.model.md` (тот паттерн — для будущих `comments`/`votes`/`tags`, привязанных к посту/make/модели одновременно; здесь голоса и теги нужны только моделям, полиморфизм заводить рано).

```sql
create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name = lower(name) and length(name) > 0),
  created_at timestamptz not null default now()
);

create table model_tags (
  model_id uuid not null references models(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (model_id, tag_id)
);
create index model_tags_tag_idx on model_tags (tag_id);

create table model_votes (
  model_id uuid not null references models(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (model_id, user_id)
);

alter table models add column votes_up int not null default 0;
alter table models add column votes_down int not null default 0;
alter table models add column downloads_count int not null default 0;

create index models_created_at_idx on models (created_at desc);
create index models_popularity_idx on models ((votes_up - votes_down) desc, created_at desc);
```

- **Теги** — глобальные, свободные, без модерации в этой итерации; уникальность нормализована на уровне `check (name = lower(name))` — приложение обязано слать lowercase, БД это гарантирует, а не только доверяет вызывающему коду. Уникальный индекс на `name` создаётся самим `unique`-констрейнтом, отдельного `create index` не заводили.
- **Голоса** — up/down как `smallint` `±1`, PK `(model_id, user_id)` — один голос на пару, смена голоса (up→down или снятие) — `update`/`delete` строки на слое API, не отдельная история голосований.
- **Счётчики `votes_up`/`votes_down`/`downloads_count` на `models`** — денормализация ради сортировки каталога без агрегирующего join по каждому запросу списка. Источник истины для голосов — `model_votes`; консистентность счётчика поддерживает API-слой (инкремент/декремент при голосе), триггеры сознательно не заводим на MVP (см. решение по `user_activation`-паттерну — простота важнее на этом этапе).
- **Индексы под каталог**: `models_created_at_idx` — лента «новых» по всей таблице (`models_owner_idx` уже покрывает «мои модели» через `owner_id`, это разные паттерны запроса); `models_popularity_idx` — выражение `(votes_up - votes_down)` с `created_at` как tie-breaker, под сортировку «популярные»; `model_tags_tag_idx` — фильтр каталога по тегу.
- **Не в этой итерации** (см. поручение MF-462): карма/репутация, подписки, коллекции, комментарии, отдельная таблица скачиваний-как-событий — счётчика `downloads_count` достаточно на MVP.

## Модуль хранилища и приём загрузок (Фаза 1, MF-455 — реализовано 2026-07-05)

- **`apps/api/src/storage/s3.ts`** — общий клиент S3 (креды из env: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`; без них `getClient()` возвращает `null`, ручки отвечают понятной ошибкой вместо падения — тот же паттерн, что уже был у `putAuthObject`). Бакет моделей — `S3_BUCKET_MODELS` (default `3mf`). Примитивы: `putModelObjectStream` (заливка через `@aws-sdk/lib-storage` `Upload` — не буферит файл целиком в памяти), `deleteModelObject`, `getModelObjectPresignedUrl`, `modelObjectKey(modelId, role, ext)` → `models/{model_id}/{role}.{ext}`.
- **Правило продукта:** `getModelObjectPresignedUrl` — общий примитив, но вызывающий код НИКОГДА не должен отдавать presigned URL для `role: 'source'` пользовательским ручкам (исходник не раздаётся). Актуально для будущих ручек скачивания `canonical_3mf`/`preview` (следующая фаза MF-8).
- **`apps/api/src/models/upload.ts`** — `POST /models` (авторизован через сессионную куку, закрыт общим preHandler-хуком в `server.ts`). Приём multipart (`@fastify/multipart`), поля: `file` (обязательно), `title` (опционально). Валидация — расширение (`stl`/`step`/`stp`/`3mf`) как основной гейт, mimetype — мягкая проверка (отсекает явно несовместимые значения, `application/octet-stream` разрешён везде, т.к. браузеры/curl часто шлют его для CAD-файлов). Лимит размера — 100 МБ (`@fastify/multipart` `limits.fileSize`, потоковая проверка без буферизации). При превышении/невалидном типе — 413/415, модель не создаётся (или удаляется, если запись уже была вставлена до обнаружения `truncated`).
- **Поток обработки:** insert `models(status='pending')` → потоковая заливка в S3 по ключу `source` (параллельно считаются `sha256` и `size_bytes` без буферизации) → insert `model_files(role='source', ...)`. Если заливка не удалась — строка `models` удаляется (без осиротевших записей без файла).
- **503 без кредов:** до старта обработки multipart ручка проверяет `isModelsStorageConfigured()` — без `S3_*` в env отвечает `503 storage_not_configured`, не пытаясь стримить (см. дополнение Architect в MF-455 — креды появятся отдельно, MF-454).
- **Интеграционный тест** — `apps/api/src/storage/s3.test.ts`, против реального бакета `3mf`: заливка объекта → presigned URL → скачивание → сверка байт → удаление. Пропускается (`describe.skipIf`), если `S3_*` не заданы в env — не роняет обычный прогон/CI без секретов, зелёный при наличии кредов.
- **Юнит-тесты ручки** — `apps/api/src/models/upload.test.ts`: 401 без сессии, 503 без кредов, 415 на неподдерживаемое расширение.

## Фазы (для разбивки на под-задачи в трекере)

1. **Фаза 1 — MVP-конвейер:** upload любого мешевого формата (STL/OBJ) → `trimesh` нормализация → упаковка в 3MF (Core + Materials + Production через `lib3mf`, спайк на реальном файле) → S3.
2. **Фаза 2 — Secure Content** (если подтверждено п.2 выше).
3. **Фаза 3 — STEP-приём** (если нужно раньше v2).
4. **Фаза 4 — Volumetric как маркетинговый флагман** (после того как хотя бы 1 инструмент в экосистеме сможет это прочитать — отслеживать).

## Критерии приёмки (для Фазы 1)

- Загрузка STL/OBJ → на выходе валидный `.3mf`, открывается в OrcaSlicer/Bambu Studio/PrusaSlicer БЕЗ ошибок.
- Цвет/материал, заданный при загрузке, виден в слайсере после открытия.
- **Multipart-модель сохраняет сборку (Production extension) — детали не «слипаются» в один меш.** Реализовано в MF-376; сводный статус и граница MF-337 описаны в [матрице конвертера](converter.status.md).
- Оригинальный файл пользователя нигде не отдаётся наружу (только `.3mf`).

## Чек-лист ручной проверки в слайсерах (MF-376)

Автотест `apps/mesh/tests/test_convert.py::test_multipart_colored_source_preserves_parts_and_colors`
проверяет структуру через `lib3mf`/OPC программно (число объектов, build item'ов,
цветов), но не заменяет открытие в реальном слайсере — в агентском окружении
(headless VDS-воркер) нет GUI ни для одного из трёх слайсеров, поэтому эта
часть критерия принципиально ручная. **Не выполнено — ждёт прогона
человеком/QA с установленными OrcaSlicer/Bambu Studio/PrusaSlicer.**

Как получить тестовый файл: собрать мультипарт-цветной источник (2+ объекта,
разные `usemtl`/цвета в OBJ, как в фикстуре
`_fixture_multipart_colored_obj` теста) и прогнать через
`mesh.convert.convert_to_3mf`, либо использовать реальную многодетальную
модель (напр. nier2b, `3dmake/DEMO.md`) как источник.

- [ ] OrcaSlicer: файл открывается без ошибок/предупреждений о повреждении.
- [ ] OrcaSlicer: число объектов на билд-плейте совпадает с исходным (не слиплись в один меш).
- [ ] OrcaSlicer: цвет/материал каждого объекта виден и соответствует исходному.
- [ ] Bambu Studio: то же самое (открытие / число объектов / цвет).
- [ ] PrusaSlicer: то же самое (открытие / число объектов / цвет) — версия ≥ марта 2024 (Production ext.).
- [ ] Габарит модели в слайсере совпадает с ожидаемым (проверка единиц — нет эффекта 25.4×).
