# MVP-цепочка: экраны, API-контур, автоподбор принтера

Issue-указатель: [MF-382](mention://issue/36bb0cb2-fc34-4484-a400-5c345ed37e38) (Фаза 2 эпика [MF-23](mention://issue/e307dec6-06a8-4616-ad51-19ba8d74a3f7)).
**Статус: спека — 2026-07-19.** Требования, не код (см. «Готово когда» MF-382/MF-23) — рабочая
реализация уходит отдельными карточками фаз 2/3, часть уже реализована ДО этой карточки
параллельными эпиками (MF-31/32/33/390/453 и др.) — см. § «Сверка» ниже, не переизобретаем.

P0-цепочка по телу эпика: каталог → карточка модели → «отправить в печать» (автоподбор принтера)
→ личный парк «Цех» → деталь принтера со спулами. Источник сущностей —
[docs/issues/007.database.design.md](../issues/007.database.design.md) и
[domain.model.md](domain.model.md).

## Сверка: что из P0 уже реализовано (не переоткрываем)

| Кусок P0 | Статус в коде | Где |
|---|---|---|
| Каталог (сетка, поиск/сорт/тег/автор фильтры, keyset-курсор) | реализовано | `GET /models` (`apps/api/src/models/list.ts`), `apps/web/src/home/catalog.ts` |
| Карточка модели (мета+файлы+голос) | реализовано | `GET /models/:id` (`apps/api/src/models/detail.ts`) |
| «Нужный стол» модели (bbox из исходника, не из превью-GLB) | реализовано | `models.bbox jsonb`, заполняется на аплоаде (MF-453/MF-22) |
| Пайплайн ассетов: децимация только превью-GLB, исходник в S3 нетронут | реализовано | `docs/epics/3mf.storage.md`, `docs/epics/domain.model.md` § «Демо-мастерская», п.2 эпика MF-23 |
| Личный парк — список принтеров пользователя | реализовано | `GET /me/printers` (`apps/api/src/profile/activation.ts`), экран `apps/web/src/park/parkscreen.tsx` |
| Деталь принтера — live-состояние, гейджи, команды | реализовано | `GET /me/printers/:id/live`, `apps/web/src/park/printerlivescreen.tsx` |
| Совместимость станок×филамент×модель (каталожный уровень, геометрия+семейство) | реализовано | `compat.check` (`apps/api/src/compat/check.ts`, MF-409) + `GET /me/printers/:id/compat` (MF-1060) |

Реально недостающее для замыкания P0-цепочки — три вещи, специфицированные ниже: (1) поле
«спул заряжен в КОНКРЕТНОМ принтере прямо сейчас» (§4), (2) MAINT_DEFS как данные (§3.4), (3) UI/API
связка «модель → печать» поверх уже готового `compat.check` (§4.2).

## 1. MVP-экраны P0-цепочки

Для каждого экрана: назначение, поля, источник (сущность из 007/domain.model.md), новое или уже
реализовано.

### 1.1 Каталог (`/market` / `/projects`, уже есть — фиксируем контракт)

Сетка карточек + фильтр внутри категории. Нейропоиск — отдельный контур
[issues/003.neural.search.md](../issues/003.neural.search.md) / [neural.search.md](neural.search.md),
здесь не дублируется — каталог принимает `?q=` и делегирует ранжирование туда, когда контур будет
готов; сегодня `q` матчит title/description/тег текстовым поиском (MF-555).

| Поле карточки | Источник |
|---|---|
| `title`, `description` (обрезано) | `models.title`/`description` |
| `thumb_url` | `model_files.role='thumbnail'` через `models/assets.ts` |
| `votes_up`/`votes_down`, `downloads_count` | `models` счётчики (MF-462) |
| `owner_username`, `trusted_uploader` | `users.username`, агрегат `uploaderReputation.ts` |
| `price_minor`/`currency` | `models.price_minor` (MF-363, если карточка платная) |
| теги | `model_tags`/`tags` |

Фильтры строки запроса: `q`, `sort=new|popular`, `tag` (повторяемый), `owner`, `cursor` — уже
контракт `GET /models`, см. §2.1.

### 1.2 Карточка модели (`/market/model/:id`, уже есть — фиксируем недостающие поля)

| Блок | Поля | Источник |
|---|---|---|
| 3D-просмотр | GLB превью-URL (ленивая загрузка), постер-фолбэк на время загрузки/отсутствия GLB | `model_files.role='preview_glb'`/`thumbnail` |
| Статы | рейтинг (votes_up/down), просмотры, скачивания, полигоны+размер файла из manifest, деталей (частей) | `models` счётчики + upload-manifest (децимация, п.2 эпика) |
| Нужный стол | bbox исходника (мм, X×Y×Z) | `models.bbox` |
| Лицензия | `models.license` (если есть) или дефолт правообладателя | `models` |
| Описание | редактируемое владельцем | `models.description` (уже редактируется, `mutate.ts`) |
| CTA «Отправить в печать» | статус кнопки — см. §4.2 (автоподбор) | — |

### 1.3 Личный парк «Цех» (`/park`, уже есть — фиксируем шапку/баннер как контракт)

Сетка парка + шапка-статистика + баннер «требуют внимания».

| Элемент | Данные | Источник |
|---|---|---|
| Плитка принтера | название, бренд/модель, `phase` (printing/idle/paused/error/offline), поддержка (`list`/`managed`/`custom`) | `user_printers` + `LiveState` (`park/livesource.ts`) |
| Шапка-статистика | count(печатают) / count(свободны) / count(требуют обслуживания) / count(проблема) | агрегат по `LiveState.phase` + MAINT_DEFS-статусу (§3.4, ещё не данные) |
| Баннер «требуют внимания» | принтеры с `phase='error'` ИЛИ просроченным пунктом обслуживания | то же |

Статистика уже частично считается на клиенте из `LiveState` (`phase`); часть про «обслуживание»
не данные — см. §3.4, это новое.

### 1.4 Деталь принтера (`/printer/:id`, уже есть — фиксируем недостающие подтабы/спулы)

| Подтаб | Данные | Источник |
|---|---|---|
| Состояние | live-гейджи (temp/обдув/сеть/калибровка), фаза | `GET /me/printers/:id/live`, `device_state`/`device_telemetry` |
| Печать | текущее задание, прогресс | `device_jobs`/`device_state` |
| История | прошлые задания | `device_jobs` (терминальные) |
| Обслуживание | пункты регламента (сопло/ремни/смазка), статус «скоро/просрочено», кнопка reset счётчика | **новое**, см. §3.4 (MAINT_DEFS) |
| Спулы у принтера | какой материал сейчас заряжен, остаток (оценка) | **новое**, расширение `user_materials`, см. §4.1 |

## 2. API-контур `apps/api` для MVP-цепочки

Метод/путь/схема ответа под экраны выше. Отмечено, что уже есть (не реализуем заново) и что новое
для этой фазы. Схемы — TS-подобная нотация, не JSON Schema буквально (стиль уже принят в этом
репо, см. `docs/architecture/readme.md`).

### 2.1 Каталог — `GET /models` (уже реализовано, контракт фиксируем)

```
GET /models?q=&sort=new|popular&tag=&owner=&cursor=&limit=
→ 200 {
    models: Array<{
      id: string; title: string; description: string | null; status: string;
      craft: string; created_at: string; votes_up: number; votes_down: number;
      downloads_count: number; owner_username: string; trusted_uploader: boolean;
      price_minor: string; currency: string; thumb_url: string | null; tags: string[];
    }>;
    next_cursor: string | null;
  }
```

### 2.2 Карточка модели — `GET /models/:id` (уже реализовано, +bbox уже в ответе)

```
GET /models/:id
→ 200 {
    id: string; title: string; description: string | null; status: string;
    source_format: string; craft: string; bbox: { x: number; y: number; z: number } | null;
    license?: string; owner_id: string; owner_username: string;
    files: Array<{ id: string; role: string; size_bytes: number; original_filename: string }>;
    my_vote?: number;
  }
→ 404 { error: "not_found" }
```

### 2.3 Парк принтеров пользователя — `GET /me/printers` (уже реализовано, контракт фиксируем)

```
GET /me/printers  (auth required)
→ 200 { printers: Array<{
    id: string; label: string; brand: string | null; model: string | null;
    link_source: "manual" | "agent"; support_level: "list" | "managed" | "custom";
    build_volume: { x: number; y: number; z: number } | null;
  }> }
→ 401 { error: "unauthorized" }
```

### 2.4 Деталь принтера — `GET /me/printers/:id/live` (уже реализовано)

```
GET /me/printers/:id/live  (auth required, owner only)
→ 200 { phase: "printing"|"ready"|"idle"|"paused"|"error"|"offline"; live: boolean;
    gauges?: { temp_nozzle_c?: number; temp_bed_c?: number; fan_pct?: number };
    job?: { progress_pct: number; eta_at: string | null } | null;
  }
→ 403 { error: "forbidden" }  → 404 { error: "not_found" }
```

### 2.5 Спулы у принтера — `GET /me/printers/:id/spools` (новое, см. §4.1 под схему)

```
GET /me/printers/:id/spools  (auth required, owner only)
→ 200 { spools: Array<{
    id: string;            -- user_materials.id
    material_id: string; material_name: string; material_type: string;
    variant_id: string | null; color_name: string | null; color_hex: string | null;
    remaining_g: number | null;   -- оценка, null = неизвестно (нет датчика)
    loaded_at: string | null;
  }> }
```

Опирается на `user_materials.printer_id`/`remaining_g`/`loaded_at` — прообраз в domain.model.md
§ «Демо-мастерская», DDL повторён в §4.1 этого документа (там же — почему расширение существующей
таблицы, а не новая сущность).

### 2.6 Регламент обслуживания — `GET /me/printers/:id/maintenance` (новое, см. §3.4)

```
GET /me/printers/:id/maintenance  (auth required, owner only)
→ 200 { items: Array<{
    key: string;            -- 'nozzle' | 'belts' | 'lubrication' | ... (расширяемо)
    label: string;          -- «Сопло», «Ремни», «Смазка»
    interval_hours: number; -- регламентный интервал (MAINT_DEFS)
    hours_since_reset: number;
    status: "ok" | "due_soon" | "overdue";
  }> }
POST /me/printers/:id/maintenance/:key/reset  (auth required, owner only)
→ 204
```

## 3. Регламент обслуживания как данные (MAINT_DEFS)

Демо хранит регламент как статическую таблицу констант (`data.js:305`: сопло 600ч / ремни 450ч /
смазка 250ч → статус «скоро»/«просрочено» + сброс счётчика). Перенос в портал — **данные, не
хардкод в UI**, иначе неверифицируемо и не расширяется под новые типы станков (ЧПУ/лазер).

Решение: справочник-константа на уровне API (не отдельная БД-таблица в MVP — YAGNI, значений
мало, меняются редко, тот же принцип, что уже применён к `orders.status`/`print_requests.status`
в domain.model.md), плюс счётчик наработки на `user_printers` или `device_state`:

```sql
-- прообраз, будущая миграция (не эта карточка — Фаза 3):
alter table user_printers add column if not exists maintenance_reset jsonb not null default '{}';
-- {"nozzle": "2026-07-01T00:00:00Z", "belts": "2026-06-01T00:00:00Z", ...}
-- "hours_since_reset" на чтении = сумма print-job-часов (device_jobs) с момента reset[key],
-- не отдельный счётчик — тот же принцип "агрегат на чтении, не денормализованное поле",
-- что уже применён к балансу/репутации в domain.model.md.
```

`MAINT_DEFS` (интервалы по умолчанию: сопло 600ч / ремни 450ч / смазка 250ч) — константа в коде
API (`apps/api/src/devices/maintenanceDefs.ts`, новый файл), не БД-таблица: интервалы одинаковы
для всех станков в MVP (демо тоже не различает по бренду), различение по `machines.kind`/семейству
— P1, если понадобится.

## 4. Связка «модель → печать» с автоподбором (printerFit / openPrintFlow)

Демо: `printerFit` (`app.js:152`) + `openPrintFlow` (`app.js:554`). Ключевая мостовая фича —
отличает портал от MakerWorld/Printables (эпик MF-23 «Зачем»). **Важно: не выдавать эвристику
демо (`NEEDMM[id]` хардкод) за готовую фичу** — часть уже решена продовым `compat.check`
(геометрия из реального bbox, MF-409/MF-1060), часть — открытый пробел, специфицируется ниже.

### 4.1 Что уже есть vs что нужно добавить

`GET /me/printers/:id/compat?material_id=&model_id=` (уже в проде, MF-1060) считает:
- геометрию — `models.bbox` (реальный bbox исходника, НЕ хардкод) против `build_volume` станка,
  с учётом поворота по Z (X/Y своп) — **уже закрывает** требование карточки «need из реального
  bbox, учёт ориентации»;
- совместимость на уровне КАТАЛОГА — «этот материал ВООБЩЕ подходит этому станку» (закалённое
  сопло/камера/директ-драйв/температура/диаметр), НЕ «этот материал СЕЙЧАС заряжен в ЭТОТ
  принтер».

Пробел P0 (зафиксирован в domain.model.md § «Демо-мастерская», ещё не мигрировано): нет поля «эта
катушка заряжена в этот принтер прямо сейчас» — `bedOk` демо требует именно это (`материал
заряжен в спул`), не абстрактную совместимость каталога. Решение — расширение `user_materials`
(не новая таблица `spools`, та же катушка не мигрирует между сущностями):

```sql
-- прообраз, будущая миграция Фазы 2/3 (повтор DDL из domain.model.md для локальности спеки):
alter table user_materials add column if not exists printer_id uuid
  references user_printers(id) on delete set null; -- null = на складе/не заряжена никуда
alter table user_materials add column if not exists remaining_g int
  check (remaining_g is null or remaining_g >= 0); -- null = неизвестно, нет датчика у большинства станков
alter table user_materials add column if not exists loaded_at timestamptz;
create index if not exists user_materials_printer_idx on user_materials (printer_id) where printer_id is not null;
```

`remaining_g` — оценка (ручной ввод юзера vs пересчёт по времени печати — открытый вопрос, решать
при реализации Фазы 2/3, не в этой спеке).

### 4.2 Алгоритм автоподбора (карточка модели → кнопка «Отправить в печать»)

Вход: `model_id` (текущая карточка), список `user_printers` пользователя с их `printer_id`.

1. Для каждого `user_printer` из парка вызвать (переиспользуя существующий `compatCheck`, НЕ новую
   функцию — geometry-правило уже там):
   - `bedOk = fitsBuildVolume(models.bbox, user_printer.build_volume)` — уже есть в `compat/check.ts`.
   - `materialOk` — среди `user_materials` с `printer_id = user_printer.id` (заряжено СЕЙЧАС) есть
     ли запись, чей `material_id`/`variant_id` проходит family-правила `compatCheck` для
     `models.recommended_material_id` (если задан у модели) или без ограничения по материалу,
     если модель его не специфицирует.
2. Состояние кнопки на карточке модели (три потока из тела эпика):
   - **Подходит** (есть ≥1 принтер с `bedOk && materialOk`) → кнопка «Печать», активна, ведёт на
     `POST /me/printers/:id/print-jobs` (вне периметра этой спеки — контракт задания на печать,
     Фаза 3).
   - **Нет филамента** (есть принтер с `bedOk`, но ни один заряженный спул не подходит) → кнопка
     «Поставлю вручную» (юзер подтверждает печать без проверки материала) ИЛИ «тем что стоит»
     (использовать заряженный материал без строгой проверки совместимости, с warn-баннером из
     `compat.check.reasons`). `whereLoaded` — подсказка «нужный пластик заряжен в №<printer_id>»,
     если он ЕСТЬ у другого принтера пользователя (запрос по `user_materials.printer_id is not
     null and material_id = ...`), с предложением перенести туда печать.
   - **Стол мал** (ни один принтер парка не проходит `bedOk`) → кнопка disabled, тултип с
     фактическим bbox модели и лучшим доступным столом парка (для ориентира «на сколько мм не
     хватило»).
3. Разбиение модели на печатаемые детали, если ни один стол не влезает целиком (демо это
   подразумевает через manifest «раздельные детали») — **нетривиально, НЕ реализуется этой
   спекой**: требует либо ручного разбиения автором при загрузке (проще, P0-совместимо: поле
   `model_files.role='part'` уже поддерживается мультифайловой моделью, MF-340), либо
   автоматического slicing-уровня разбиения (P1+, вне контура MVP). Явно фиксируем как открытый
   вопрос Фазы 3, не выдаём за решённое.

### 4.3 API-эндпоинт для UI-кнопки (новое)

```
GET /models/:id/print-fit  (auth required)
→ 200 {
    model_id: string;
    fits: Array<{
      printer_id: string; label: string;
      bed_ok: boolean;
      material_ok: boolean;               -- заряженный спул проходит family-правила
      loaded_material?: { material_id: string; name: string } | null;
      reasons: Array<{ code: string; severity: "warn" | "blocked"; message: string }>;
    }>;
    -- где ещё в парке (не заряжен здесь, но есть) лежит подходящий материал:
    where_loaded: Array<{ printer_id: string; material_id: string; name: string }>;
  }
```

Реализация — тонкий агрегатор поверх уже существующего `compatCheck` + новых колонок
`user_materials.printer_id`/`remaining_g`/`loaded_at` (§4.1): по одному вызову `compatCheck` на
принтер парка, не N+1 к БД (материалы/принтеры парка читаются одним запросом каждый). Не дублирует
`GET /me/printers/:id/compat` (тот — низкоуровневый «этот один принтер против этого одного
материала/модели», этот — «весь парк против одной модели», агрегат для кнопки карточки).

## Готово когда

- [x] Список MVP-экранов P0-цепочки с полями и источником — §1 (сверено с уже реализованным, не
      задублировано).
- [x] Контур API `apps/api` под экраны — метод/путь/схема ответа — §2 (существующие эндпоинты
      зафиксированы контрактом, новые — `GET /me/printers/:id/spools`,
      `GET /me/printers/:id/maintenance` + reset, `GET /models/:id/print-fit`).
- [x] Алгоритм автоподбора принтера (`printerFit`/`bedOk`), три пользовательских потока
      (подходит/нет филамента/стол мал), разделение исходник-vs-превью в пайплайне ассетов
      (уже реализовано, сверено) — §4. «Разбиение на детали» явно оставлено открытым вопросом, не
      выдано за решённое (см. §4.2 п.3).

Не входит в эту карточку (Фаза 3, реализация): миграция `user_materials`
`printer_id`/`remaining_g`/`loaded_at`, реализация трёх новых эндпоинтов, `MAINT_DEFS`
как код-константа, `POST /me/printers/:id/print-jobs` (сам запуск печати — контракт задания вне
периметра этой спеки).
