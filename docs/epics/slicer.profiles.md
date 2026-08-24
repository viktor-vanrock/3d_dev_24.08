# Слайсер-профили — единая схема + база базовых профилей (MF-411, фаза 1 эпика MF-34)

**Статус:** схема спроектирована и задеплоена (Data), 2026-07-10 — шаг «unified profile schema + хранение» фазы 1. Шаг «агент-парсер OrcaSlicer» (Step 2) сделан и залит на `dev` (Mesh), 2026-07-11: данные подтверждены в реальном `portal_dev`. Шаг «PrusaSlicer/Cura + RU-специфика» (Step 3) — часть PrusaSlicer сделана, залита и повторно ПОДТВЕРЖДЕНА в `dev` (Mesh), 2026-07-11 06:15 UTC, см. «Проверка дев-БД» ниже (первый прогон в базу не долетел, перезапуск закрыл расхождение); часть RU-специфика (RU-филаменты, честная экстраполяция) сделана и залита на `dev` (Mesh), 2026-07-11 06:45 UTC, см. «RU-специфика» ниже; часть Cura (quality-тиры + материалы, включая РЕАЛЬНЫЕ — не экстраполированные — RU-профили FDplast/Best Filament) сделана и залита на `dev` (Mesh), 2026-07-17, см. «Сделано этим прогоном (Cura)» ниже; часть RU-принтеры (`machine_candidates`, вне unified-схемы этой карточки) сделана и залита на `dev` (Back), 2026-07-17, MF-1803, см. «RU-принтеры» ниже — Step 3 фазы 1 закрыт полностью; best-effort отправка profile-bundle на привязанный принтер через MF-26-канал (Back), 2026-07-18, MF-1942 — стадия 4 эпика MF-34, см. «Best-effort отправка профиля на принтер» ниже; реальный Snapmaker U1 Orca-профиль + первый настоящий headless-слайс (не только импорт-валидация) на реальном корпусе SO-ARM100 (Mesh), 2026-07-19, MF-1974, см. «Snapmaker U1 — реальный Orca-профиль и headless-слайс» ниже — DB-driven диспетчер очереди под это ещё не сделан, честно задокументировано там же.
**Контекст:** [MF-34](mention://issue/f82bd665-798c-4c9a-a0f5-9fb65e638573) «Слайсер-профили (AI)», фаза 1 — [MF-411](mention://issue/c689504d-554b-4569-b10e-12de19b7e246).

## Зачем

Профиль слайсера под связку «принтер + филамент» — обещание эпика MF-34 (v1: подбор ближайшего базового профиля + честный экспорт в OrcaSlicer/PrusaSlicer/Cura). Прежде чем что-то подбирать или генерировать, нужна база самих базовых профилей, вытащенных из open-source репозиториев слайсеров и нормализованных в единую схему — это и есть фундамент, который строит эта карточка.

Отличие от уже существующей `machine_material_profiles` (MF-402): та таблица — наши собственные ручные/будущие связки станок×материал с произвольными `overrides` (потребитель — MF-16). `slicer_profiles` ниже — это САМИ базовые профили слайсеров как данные (машина/процесс/филамент по отдельности, с наследованием), источник для заполнения (в том числе) `machine_material_profiles.overrides` и для честного экспорта. Разные сущности, общее назначение — обе питают экспорт в слайсер.

## Три класса профиля

OrcaSlicer (как и Prusa/Cura под капотом) делит профили на три класса:

- **machine** — параметры станка: объём печати, кинематика, диаметр сопла, макс. температуры, тип экструдера (direct drive/bowden), наличие камеры.
- **process** (он же «print settings») — параметры конкретного результата печати на конкретном станке: высота слоя, скорости, заполнение, стенки, поддержки.
- **filament** — параметры материала: температуры сопла/стола, охлаждение, ретракт, flow ratio, объёмная скорость, плотность/диаметр.

Уже принятая в схеме пара `machines`/`materials` (MF-31/MF-32) — это КАТАЛОГ станков и материалов (что физически существует у вендора). `slicer_profiles` — это НАСТРОЙКИ печати для этих станков/материалов у конкретного слайсера, best-effort связанные с каталогом через `machine_id`/`material_id`, но не обязанные совпадать 1:1 (профиль слайсера может существовать раньше, чем каталожная запись, и наоборот).

## Наследование — дельты, не плоская копия

OrcaSlicer хранит профили через `inherits`: дочерний профиль содержит ТОЛЬКО отличия от родителя (например, `0.20mm Standard @BBL X1C` наследует от `fdm_process_common` и переопределяет несколько полей). Плоское копирование потеряло бы этот граф происхождения и раздуло бы объём на порядок при малейшем изменении базового профиля апстримом.

Схема повторяет это устройство: `slicer_profiles.inherits_id` — self-FK, `params` — jsonb с ТОЛЬКО дельтой этой записи. Резолвер (потребитель, MF-16 — вне территории Data) идёт вверх по цепочке `inherits_id` и мёржит `params` сверху вниз (родитель → дочерний, дочерний переопределяет). Пример SQL-обхода (recursive CTE) — см. комментарий в миграции `20260710140000_slicer_profiles.sql`, проверен локально (docker Postgres 16) на трёхуровневой цепочке machine→process, дельты резолвятся корректно.

## Провенанс: source + license + confidence

Эпик прямо требует юридической чистоты (AGPL/GPL — атрибуция) и честного `confidence` там, где взят не точный, а экстраполированный профиль (RU-филаменты без готовых вендорских данных — фаза 3 эпика MF-34/MF-411).

- `source_name`/`source_url`/`source_ref`/`license` — обязательны (`license` — `not null`) на каждой записи. `source_ref` — путь файла/коммит в исходном репозитории (воспроизводимость: откуда именно взято).
- `confidence numeric(3,2)` (0..1) — `1.0` = профиль взят из источника как есть; `<1` = экстраполяция.
- `extrapolated_from_id` (self-FK) + `extrapolation_reason` — когда профиль выведен не из слайсер-репозитория напрямую, а от родственного профиля той же унифицированной схемы (пример: RU-филамент FDplast PLA без своего вендорского профиля — экстраполирован от `Bambu PLA Basic`, см. фикстуру `filament.ru.extrapolated.example.json`).

## JSON Schema — контракт парсер-агента

`apps/api/src/db/schemas/slicer-profile.schema.json` (draft-07) — формальный контракт единичной ДЕЛЬТЫ профиля, который парсер-агент обязан произвести перед записью в `slicer_profiles.params`+сопутствующие колонки. Валидирована собственным лёгким структурным валидатором (без внешних зависимостей) на фикстурах в `apps/api/src/db/schemas/__fixtures__/` — по одной на каждый класс (`machine.example.json`, `process.example.json`, `filament.example.json`) + отдельная фикстура на путь экстраполяции (`filament.ru.extrapolated.example.json`). Тест — `apps/api/src/db/schemas/slicer-profile.schema.test.ts` (`pnpm test` в `apps/api`), 9 проверок: все три класса покрыты, каждая фикстура валидна, невалидный `profile_class` и профиль без `license` отклоняются, экстраполированный профиль с `confidence < 1` проходит.

### Словарь `params` (v1, растёт без ломки схемы — принцип 2 domain.model.md)

Ключи — унифицированные, НЕ сырые имена настроек конкретного слайсера (у Orca/Prusa/Cura разное написание/семантика одних и тех же вещей, см. «Открытые вопросы» ниже) — из них генерируется экспорт под каждый слайсер отдельно (вне территории Data).

| Класс | Ключи |
|---|---|
| machine | `build_volume_mm{x,y,z}`, `kinematics`, `nozzle_diameter_mm`, `max_nozzle_temp_c`, `max_bed_temp_c`, `has_heated_chamber`, `extruder_type`, `gcode_flavor` |
| process | `layer_height_mm`, `first_layer_height_mm`, `print_speed_mm_s`, `first_layer_speed_mm_s`, `travel_speed_mm_s`, `infill_density_pct`, `infill_pattern`, `wall_loops`, `top_shell_layers`, `bottom_shell_layers`, `support_enable`, `support_type`, `skirt_loops`, `brim_width_mm`, `cooling_fan_speed_pct{min,max}` |
| filament | `nozzle_temperature_c{first_layer,other}`, `bed_temperature_c{first_layer,other}`, `max_volumetric_speed_mm3_s`, `flow_ratio`, `retraction_length_mm`, `retraction_speed_mm_s`, `z_hop_mm`, `pressure_advance_k`, `density_g_cm3`, `diameter_mm`, `cost_per_kg` |

`additionalProperties: true` на `params` — парсер-агент может писать ключи сверх словаря (не блокирует ингест на нехватку схемы), но новые часто встречающиеся ключи стоит добавить сюда отдельной правкой JSON Schema, чтобы резолвер/экспорт мог на них полагаться типизированно.

## Схема БД

Миграция `apps/api/db/migrations/20260710140000_slicer_profiles.sql` (dbmate, идемпотентна, прогнана вперёд→назад→вперёд локально, docker Postgres 16 — см. «Проверено» ниже).

- **`slicer_profiles`** — канон. `profile_class`/`slicer` — text+check (принцип 2, растёт без Postgres-enum). `setting_id` nullable (Prusa/Cura без него) с partial-unique `(slicer, setting_id)` — идемпотентный upsert по native id. `inherits_id`/`extrapolated_from_id` — self-FK, NO ACTION (дефолт) + check против self-reference (`slicer_profiles_no_self_inherit`/`_no_self_extrapolate`) — защита от случайного цикла в одну запись, полный цикл через 2+ записи не ловится DB-констрейнтом (проверка ациклии — на резолвере, вне территории Data). `vendor_id`/`machine_id`/`material_id` — best-effort матчинг на каталог, nullable, не блокирующий (тот же паттерн, что `printer_id` в `user_printers`/`machine_candidates.matched_machine_id`). `params jsonb` — дельта (принцип 5, реляционных колонок под видо-специфичные настройки не заводим). `content_hash` + partial unique — идемпотентный bootstrap-импорт (тот же паттерн, что `machines.content_hash`, MF-405). `bundle_s3_key` — указатель на исходный bundle-файл в S3 (см. «S3-раскладка» ниже), nullable/best-effort. `status` — `active`/`quarantined`/`archived`, зеркалит `machines.status`.
- **`slicer_profile_candidates`** — очередь дедупа/ревью до слияния в канон, тот же паттерн, что `machine_candidates` (MF-32)/`material_candidates` (MF-587): заводится СРАЗУ с каноном (прецедент уже принят этой схемой — не «когда появится парсер»), чтобы парсер-агент (Step 2/3 эпика, Fullstack/Back) сразу имел куда писать сырые находки. `raw jsonb` — untouched содержимое источника (JSON-нода Orca / `.ini`-секция Prusa / container-stack Cura) ДО нормализации в унифицированную схему; нормализация в `params` происходит на слиянии в `slicer_profiles`, не в candidates.

Индексы: `(profile_class, slicer)`, `inherits_id`/`machine_id`/`material_id` (partial, not null), `status='quarantined'` (очередь ревью, тот же паттерн что `machines_status_review_idx`), GIN `jsonb_path_ops` на `params` (фильтры будущего резолвера, тот же паттерн что `machines_specs_gin_idx`/`materials_specs_gin_idx`).

## S3-раскладка (конвенция, применение кода — вне территории Data)

Bundle-файлы (полный исходный/экспортный бандл — `.orca_printer`/JSON-набор, `.ini` config-bundle, `.curaprofile`) — в S3, метаданные+дельты — в Postgres (как решено в описании фазы 1 и как уже принято для моделей: `docs/epics/3mf.storage.md`).

- **Бакет:** новый `slicer-profiles`, **приватный** (не public-read, в отличие от `3mf`/`generations` — см. открытый риск публичного offload в `docs/epics/ids.policy.md`; базовые профили сами по себе не секрет, но раздача напрямую без сессии/форензики противоречит анти-парсинг стратегии эпика «закрывать за необнаружимыми ID и троттлингом массовой выгрузки»). Отдача — прокси-стримом через API (тот же паттерн, что приватный `auth`), не presigned (тот же архитектурный аргумент, что в `ids.policy.md` — MinIO на loopback).
- **Ключ:** `slicer-profiles/{profile_id}/bundle.{ext}`, где `profile_id` = `slicer_profiles.id` (UUIDv4, criptographически случайный) — тот же принцип, что `models/{model_id}/{role}.{ext}` (необнаружимый ID = сам PK, отдельный `public_id`-хелпер не нужен, см. `docs/epics/ids.policy.md`).
- **env:** `S3_BUCKET_SLICER_PROFILES` (дефолт `slicer-profiles`) — заводится по тому же паттерну, что `S3_BUCKET_MODELS`/`S3_BUCKET_AUTH`/`S3_BUCKET_GENERATIONS` (`apps/api/src/storage/s3.ts`), когда парсер-агент начнёт реально заливать бандлы. Провижининг бакета на cloud.ru — заявка Ops (эта карточка код `s3.ts` не трогает — стриминг файлов вне территории Data, см. `ids.policy.md`).

## Проверено локально (docker Postgres 16, 2026-07-10)

- Миграция идемпотентна: повторный `up` — чистые `NOTICE ... skipping`, без ошибок.
- Прогнана вперёд→назад→вперёд: `down` дропает обе таблицы, базовые таблицы (`machines`/`materials`/`vendors`) целы; re-forward создаёт схему один в один.
- `check`-констрейнты сработали на позитивных/негативных вставках: неизвестный `profile_class` отклонён, self-inherit отклонён (`slicer_profiles_no_self_inherit`).
- Идемпотентный upsert по `(slicer, setting_id)` через `ON CONFLICT` — обновляет существующую запись, не плодит дубли.
- Recursive CTE по `inherits_id` резолвит цепочку `process → machine`, дельты `params` читаются раздельно на каждом уровне (не расплющены).
- Три класса профиля (machine/process/filament) + путь экстраполяции (`confidence < 1` + `extrapolated_from_id`) — вставлены и прочитаны сквозным join.
- JSON Schema валидирована собственным структурным валидатором на 4 фикстурах (по одной на класс + RU-экстраполяция), `pnpm test`/`typecheck` в `apps/api` — зелёные (`lint` не проверялся — eslint не установлен в этом окружении, pre-existing gap, не от этой миграции).
- Регенерация `db/schema.sql` (`dbmate up` с нуля на пустой БД) — воспроизводима, диф с уже закоммиченным `schema.sql` содержит только добавленные таблицы этой миграции.

Применение на прод — заявкой Ops после merge (Data руками на прод не пишет, см. «Граница с прод-БД» в CLAUDE.md).

## Сделано этим прогоном (Mesh, 2026-07-11, Step 2 фазы 1 MF-411)

`apps/scout/src/scout/sources/slicer_print_profiles.py` (+ `apps/scout/src/scout/db.py` upsert-функции, + CLI `run_slicer_print_profiles.py`/`scout-slicer-print-profiles-agent`, + deploy-юниты `portal.scout-slicer-print-profiles.{service,timer}`, тесты `apps/scout/tests/test_slicer_print_profiles.py`):

- Тащит `process`/`filament` классы (не `machine` — тот уже покрыт `slicer_profiles.py`/MF-627 для `machine_candidates`, другая таблица) из `resources/profiles/<vendor>/{process,filament}` OrcaSlicer, резолвит `inherits` в `inherits_id` (двухпроходно: upsert всех строк прогона → линковка по имени внутри одного (slicer, vendor, profile_class), т.к. у каждого вендора своя полная копия цепочки наследования). `params` — ДЕЛЬТА (только собственные ключи JSON-файла источника), не смёрдженная копия — резолвер (MF-16) мёржит цепочку на чтении.
- Пишет `raw` (нетронутое содержимое источника) в `slicer_profile_candidates`, затем ПРЯМОЙ промоушен в канон `slicer_profiles` (не через ручное ревью — при `confidence=1.0` источник сам есть истина, конфликт-таргет `(slicer, setting_id)` для инстанцируемых профилей / `content_hash` для абстрактных baseline-профилей без `setting_id`, которые от разных вендоров осознанно сливаются в одну каноническую строку при побайтовом совпадении).
- Прогнано на реальных данных против `dev` (не только фикстуры): 16 крупных вендоров (Creality/BBL/Anycubic/Elegoo/Voron/Artillery/FlyingBear/Flashforge/Qidi/Sovol/Snapmaker/Ratrig/Kingroon/Geeetech/TwoTrees/Prusa/UltiMaker) → **7788 канонических профилей** (2086 process + 5702 filament), **7473 с резолвленным `inherits_id`**, материалы **239×PLA / 130×PETG / 68×ABS** (порог эпика ≥3 материала × ≥50 моделей — превышен на порядки: 2077 уникальных process-имён). Идемпотентность проверена (повторный прогон одного и того же вендора не меняет счётчики). Полный каталог 133 вендоров OrcaSlicer не пройден (см. «Не сделано» ниже) — намеренно ограничено крупными вендорами ради бюджета одного прогона, остаток можно долить тем же CLI (`--vendor <name>`, повторяем) в любой момент.
- `pytest`/`ruff` в `apps/scout` зелёные (121 тест, включая 9 новых на нормализацию/дельты/edge-cases nil-значений).

## Сделано этим прогоном (Mesh, 2026-07-11, Step 3 фазы 1 MF-411 — часть Prusa)

`apps/scout/src/scout/sources/slicer_print_profiles_prusa.py` (+ CLI `run_slicer_print_profiles_prusa.py`/`scout-slicer-print-profiles-prusa-agent`, + deploy-юниты `portal.scout-slicer-print-profiles-prusa.{service,timer}`, тесты `apps/scout/tests/test_slicer_print_profiles_prusa.py`):

- Тащит `print`/`filament` INI-секции из вендорского бандла PrusaSlicer-settings (`live/PrusaResearch/<version>.ini`, тот же бандл, что уже фетчит `slicer_profiles.py`/MF-627 для machine-класса — переиспользует его `parse_prusa_bundle`/`_list_prusa_bundle_versions`/`_pick_latest_bundle_version`), резолвит `inherits = A; B` (Slic3r-конвенция, `;`-разделитель) в `inherits_id`: т.к. схема поддерживает только одного родителя (`inherits_id` — self-FK), линкуется ПЕРВЫЙ parent из списка (primary), дополнительные mixin-родители — задокументированное ограничение (см. «Открытые вопросы» #4). `params` — ДЕЛЬТА (только собственные ключи INI-секции), не смёрдженная копия.
- Абстрактные/миксин-секции (`[print:*common*]`, `[filament:*PLA*]` — обёрнуты в `*`, аналог `fdm_process_common` у Orca) помечаются `instantiable=False`, как и у Orca-парсера.
- Ретракт (`retract_length`/`retract_speed`) у PrusaSlicer живёт в секции `[printer:...]`, не в `[filament:...]` (в отличие от Orca) — сознательно не тронут этим прогоном (вне словаря `params` для filament-класса), см. «Открытые вопросы» #5.
- Прогнано на реальных данных против `dev` (не фикстуры): единственный реальный vendor-бандл в этом репозитории — `PrusaResearch` (см. докстринг `slicer_profiles.py` — `PrusaResearchSLA` — заглушка без машин), бандл `1.14.2.ini` → **2032 профиля** (338 process + 1694 filament), **1991 с резолвленным `inherits_id`**, среди инстанцируемых филаментов — **12×PETG, 9×ASA, 8×PC, 5×HIPS/PP, 2×PLA** и другие (PLA/PETG/ABS-порог эпика уже перекрыт OrcaSlicer-данными Step 2; этот прогон добавляет ров/охват — реальные вендорские филаменты типа `Spectrum GreenyHT` с честными температурами, не только Generic). Идемпотентность проверена (повторный прогон: тот же `found`/`promoted`=2032, `inherits_linked`=0 — уже слинковано).
- `pytest`/`ruff check` в `apps/scout` зелёные (120 тестов, включая 8 новых на нормализацию/дельты/multi-parent-inherits/абстрактные секции).

## Проверка дев-БД (Mesh, 2026-07-11, 06:15 UTC)

Зашёл на `f82bd665`/MF-34 повторно (эпик всё ещё ждёт, пока Back начнёт MF-412) и перед тем как продолжать Step 3, проверил, что данные из прошлых прогонов реально лежат в `portal_dev` (тот же Postgres, что `portal.api-dev.service`/`portal.mesh-dev.env`, не отдельный докер-скретч) — по принципу «доказано корпусом, не „на моём кубике“».

**Нашёл расхождение:** `slicer_profiles` содержал только OrcaSlicer (7788 строк, Step 2) — заявленные в предыдущем комменте 2032 строки PrusaSlicer (Step 3, часть Prusa) в базе отсутствовали, хотя коммит `86706bb` с кодом парсера на `dev` есть и код рабочий. Похоже, тот прогон писал не в этот `portal_dev` (или запись не долетела) — причина не установлена, не стал тратить время на археологию задним числом.

**Почему это не «зря сделанная работа» задним числом, а важная проверка:** MF-412 (Back) читает `slicer_profiles` напрямую — если бы Back начал работу до того, как это вскрылось, движок подбора увидел бы только Orca-профили и по PrusaSlicer связкам отдавал бы «нет базового» там, где база на самом деле должна быть.

**Исправлено:** перезапустил `scout-slicer-print-profiles-prusa-agent` (код не менял, только повторный прогон) против реального `portal_dev` — `{'found': 2032, 'candidates': 2032, 'promoted': 2032, 'inherits_linked': 1991}`. Проверил прямым SQL-запросом: `(prusaslicer, filament)=1694`, `(prusaslicer, process)=338`, инстанс с `inherits_id`=1991 — совпадает с прошлым заявленным прогоном. Идемпотентность подтверждена повторным запуском тем же CLI (`inherits_linked=0` на втором прогоне, счётчики не растут). `pytest` в `apps/scout` — 120/120 зелёные, код не менялся.

Итог: `slicer_profiles` теперь реально содержит и Orca (7788), и Prusa (2032) — 9820 строк суммарно на `dev`, готово для MF-412.

## RU-специфика (Mesh, 2026-07-11, Step 3 фазы 1 MF-411 — часть RU-филаментов)

`apps/scout/src/scout/sources/slicer_print_profiles_ru.py` (+ `db.find_slicer_profile_by_name`/
`db.resolve_slicer_profile_params` в `apps/scout/src/scout/db.py`, + `extrapolated_from_id`/
`extrapolation_reason` теперь параметры `db.upsert_slicer_profile`, + CLI
`run_slicer_print_profiles_ru.py`/`scout-slicer-print-profiles-ru-agent`, + deploy-юнит
`portal.scout-slicer-print-profiles-ru.service`, тесты `apps/scout/tests/test_slicer_print_profiles_ru.py`):

- Курируемый seed 4 RU-вендоров филамента без собственного профиля в открытых репозиториях
  слайсеров (FDplast/Bestfilament/REC/PLASTICO, названы в эпике/vision.md) × 3 материала
  (PLA/PETG/ABS) = 12 записей. В отличие от Orca/Prusa-парсеров здесь нет живого источника для
  фетча — каждая запись ЧЕСТНО помечена как экстраполяция: `confidence=0.40` (ниже дефолтного
  1.0 прямого импорта), `extrapolated_from_id` → соответствующий `Generic PLA`/`Generic PETG`/
  `Generic ABS` (OrcaSlicer/BBL, уже загружен Step 2), `extrapolation_reason` — текст по-русски
  с именем вендора и источника экстраполяции.
- `params` этого шага — НЕ придуманные вендор-специфичные числа (было бы гаданием, запрещённым
  принципами зоны Mesh — «не выдавать экстраполяцию за проверенный профиль»), а буквально
  смёрдженная цепочка `inherits_id` generic-профиля (`db.resolve_slicer_profile_params` — новый
  helper, мёржит родитель→дочерний с защитой от цикла `max_depth=32`, см. «Открытые вопросы» #2).
  Placeholder до появления реального калибровочного сигнала (эпик v2: калибровки/Make-фидбэк) —
  явно зафиксировано в `extrapolation_reason` каждой записи, не только в этом доке.
- `source_url` этого шага — `null` на всех 12 записях: у меня нет проверенных доменов вендорских
  сайтов кроме `fdplast.ru` (уже был в JSON Schema фикстуре `filament.ru.extrapolated.example.json`
  как ПРИМЕР для валидатора, не как факт), а для Bestfilament/REC/PLASTICO не стал гадать URL —
  тот же принцип «не гадать», что и с температурами. Уточнение реальных сайтов — отдельный шаг,
  не блокер для MF-412 (движку подбора для матчинга URL не нужен).
- Прогнано на реальных данных на `dev` (`portal_dev`, тот же Postgres, что `portal.api-dev.service`):
  `{'found': 12, 'skipped_no_base': 0, 'candidates': 12, 'promoted': 12}`. Идемпотентность
  подтверждена повторным прогоном (тот же counters, `slicer_profiles` не растёт: было 9820 после
  Step 2+3-Prusa, стало 9832 = +12, второй прогон не меняет счётчик). `pytest`/`ruff check` в
  `apps/scout` зелёные (128 тестов, +8 новых на `slicer_print_profiles_ru`).
- **Не сделано этим прогоном:** RU-принтеры (эпик п. «RU-специфика» упоминает и принтеры, не
  только филаменты) — отдельный шаг, не начат; уточнение реальных URL вендоров; калибровочный
  сигнал v2 (эпик прямо оставляет это на v2 — «AI-адаптация», не фаза 1).

## Сделано этим прогоном (Mesh, 2026-07-17, Step 3 фазы 1 MF-411 — часть Cura, закрывает Step 3)

`apps/scout/src/scout/sources/slicer_print_profiles_cura.py` (+ CLI `run_slicer_print_profiles_cura.py`/`scout-slicer-print-profiles-cura-agent`, + deploy-юниты `portal.scout-slicer-print-profiles-cura.{service,timer}`, тесты `apps/scout/tests/test_slicer_print_profiles_cura.py`):

- Cura устроена принципиально иначе Orca/Prusa (container-stack, не JSON/INI с явным `inherits` внутри одного файла-семейства) — источник читает ДВА независимых репозитория с разными форматами и разными лицензиями:
  - `process` ← `Ultimaker/Cura`, `resources/quality/*.inst.cfg`, ТОЛЬКО файлы верхнего уровня с `[general] definition = fdmprinter` (истинно глобальные quality-тиры: Coarse/Draft/Extra Coarse/Extra Fast/Fast/Fine/Extra Fine) — per-printer вложенные каталоги (`resources/quality/<printer>/...`, сотни вендоров × нозл × материал) сознательно не рекурсируются, тот же принцип бюджета одного прогона, что 16 вендоров OrcaSlicer. Лицензия LGPL-3.0.
  - `filament` ← `Ultimaker/fdm_materials` (материалы Cura вынесены в отдельный репозиторий), корневые `*.xml.fdm_material` (Ultimaker fdmmaterial XML), собственные `<properties>`(density/diameter) + верхнеуровневые `<settings><setting>` (print temperature/heated bed temperature), БЕЗ per-`<machine>`/per-`<hotend>` оверрайдов (та же дельта-логика "не тащим machine-специфику", что у Orca/Prusa). Лицензия CC0-1.0 — другая, чем у Cura-кода, оба лицензионных поля разные внутри одного парсера намеренно.
- `inherits_id` НЕ проставляется этим источником ни для одного класса — ни у Cura quality-тиров (independent siblings поверх `fdmprinter`-дефолтов, не цепочка друг от друга), ни у fdm_material (формат не кодирует родство с generic-профилем текстовым `inherits`) нет декларативного родителя внутри unified-схемы; см. «Открытые вопросы» #1 (обновлён).
- `setting_id` заполнен для `filament`-класса — Cura fdm_material несёт настоящий глобально-уникальный `GUID` (в отличие от Prusa/generic-Cura-quality, где такого нет), конфликт-таргет `(slicer, setting_id)`, идемпотентный upsert по реальному native id.
- **Органически (без специальной RU-логики) нашлись РЕАЛЬНЫЕ, НЕ экстраполированные Cura-профили RU-вендоров**, опубликованные самими вендорами: `fdplast_{pla,petg,abs}` (FDplast) и `bestfilament_{pla,petg,abs}` (Best Filament) — `confidence=1.0`, `extrapolated_from_id=null`, источник сам есть истина (обычный прямой импорт, тот же путь, что любой другой Cura-материал). Это сильнее курируемого RU-seed `slicer_print_profiles_ru.py` (тот — честная экстраполяция `confidence=0.40`, оставлен как есть — не дублирует эти записи, разные `slicer`/`setting_id`, обе строки сосуществуют в `slicer_profiles`). REC/PLASTICO Cura-профилей в репозитории нет — остаются только в курируемом RU-seed.
- Прогнано на реальных данных против `dev` (`portal_dev`, не только фикстуры): **288 канонических профилей** (7 process + 281 filament), включая **63×PLA / 32×PETG / 30×ABS** по имени — порог эпика (≥3 материала × ≥50 моделей) перекрыт с большим запасом ДАЖЕ без учёта Orca/Prusa, которые эту планку уже проходили независимо. Идемпотентность подтверждена повторным прогоном (`{'found': 288, 'candidates': 288, 'promoted': 288}` на обоих запусках, счётчики `slicer_profiles` не растут). `slicer_profiles` на `dev` теперь **10120 строк** суммарно (Orca 7800 + Prusa 2032 + Cura 288).
- `pytest`/`ruff check` в `apps/scout` зелёные (138 тестов, +10 новых на нормализацию/фильтр printer-specific quality-файлов/парсинг fdm_material XML без machine-оверрайдов).
- **Не сделано этим прогоном:** RU-принтеры (эпик п. «RU-специфика» упоминает и принтеры — это `machine`-класс/`machine_candidates`, отдельная таблица и отдельная граница владения от `slicer_profiles`, см. «Систематическая доливка `machine`-класса» ниже, не начато); Cura per-printer quality-профили (глубже generic-тиров — реальные вендор-специфичные print-настройки, объём на порядки больше бюджета одного прогона, см. докстринг модуля); Cura `intent`-класс (эпик § «Открытые вопросы» #1, вне словаря params этого шага).

## RU-принтеры (Back, 2026-07-17, MF-1803 — хвост RU-специфики MF-34/MF-411)

`machine_candidates`, НЕ `slicer_profiles` — отдельная таблица/граница владения (владелец `scout`, парсеры этой территории исторически ведёт Back, `apps/scout/src/scout/sources/slicer_profiles.py`/MF-627). Курируемый RU-seed добавлен в тот же файл (не новый модуль — тот же паттерн источника, что Orca/Prusa в этой карточке).

- **Проверено вручную** (contents-API трёх репозиториев, 2026-07-17): ни PICASO 3D, ни Total Z НЕ фигурируют вендорами в OrcaSlicer `resources/profiles`, PrusaSlicer-settings `live/`, ни Cura `resources/definitions` — реальная RU-специфика вне западных баз. Cura содержит `stereotech_start`/`stereotech_ste320` (RU-вендор Stereotech) — тот уже покрыт `cura-definitions` (owner=`catalog`, отдельный контур apps/api/apps/giga), сюда сознательно не задублирован.
- **Новый source_family `ru_machine_spec`** (миграция `apps/api/db/migrations/20260717190000_machine_candidates_ru_source.sql`, owner=`scout`) — НЕ переиспользует `slicer_profile`: эти записи не из слайсер-профиля, честная провенанс-метка того же духа, что `ru_filament_estimate` у `slicer_profiles` выше.
- **6 моделей, оф. страницы вендора как источник** (не третьи руки/форумы): PICASO 3D Designer X/X PRO/XL/XL PRO (`picaso-3d.ru`, build_volume 201×201×210 и 360×360×610 мм, JetSwitch — 2 сопла у PRO-версий) и Total Z AnyForm 450-PRO/950-PRO (`totalz.ru`, build_volume 450×450×450 и 950×650×950 мм). `raw.specs.build_volume` — структурный shape резолвера (`resolver/specs.py::_from_structured`), не выдуманные polygon-точки.
- **Без экстраполяции** (в отличие от RU-филаментов выше) — паспортные данные реальны и честны, но НЕПОЛНЫ там, где вендор не публикует поле (диаметр сопла, кинематика) — перечислено в `raw.incomplete_fields` на каждой записи, не додумано. Imprinta/Hercules (RU-производитель) исследован, но `imprinta.ru` рвёт TLS-соединение из окружения агента (не источник, не включён — не гадать домен/спеки без доступа к странице).
- Идемпотентность подтверждена повторным прогоном на throwaway sandbox-БД (`sandbox-db`, снятой с `dev`-миграций «с нуля» — не копия `portal_dev`, см. `check-schema-sync.sh`): второй прогон `{'found': 6, 'inserted': 0, 'updated': 0, 'unchanged': 6}`. Резолвер (`scout-resolver-agent --dry-run`) на этих 6 строках даёт `insert` с `confidence=0.95` каждая (новый вендор, конфликтов с блоком нет) — цепочка source→resolver→`machines` рабочая целиком.
- `pytest`/`ruff check` в `apps/scout` зелёные (144 теста, +6 новых на RU-принтеры).
- **Не сделано этим прогоном:** Hercules/Imprinta (недоступен из окружения агента); другие возможные RU-бренды за пределами PICASO 3D/Total Z, если найдутся — доливка отдельным заходом по той же схеме (`RU_PRINTERS` в `slicer_profiles.py`, легко расширяемый tuple).

## Экспорт в нативные форматы (Mesh, 2026-07-18, MF-413 шаг 1 фазы 3 — генераторы)

`apps/mesh/src/mesh/slicer_profile_export.py` (+ тесты
`apps/mesh/tests/test_slicer_profile_export.py`, 8 проверок):

- Три генератора — unified-словарь `params` (тот же плоский формат, что отдаёт
  `Recommendation.params` резолвера MF-412) + geometry принтера (каталог
  `machines`) → нативный bundle:
  - `build_orca_bundle` — `.orca_printer` (zip из `printer.json`/`process.json`/
    `filament.json`, envelope-поля и мэппинг ключей проверены по реальным
    файлам `SoftFever/OrcaSlicer` `resources/profiles/Creality/...`, не по
    догадке).
  - `build_prusa_bundle` — `.ini` config-бандл (секции `[print:Name]`/
    `[filament:Name]`/`[printer:Name]` + `[presets]`, тот же формат, что
    парсит `apps/scout/.../slicer_print_profiles_prusa.py` на реальных
    вендорских бандлах).
  - `build_cura_bundle` — `.curaprofile` (zip с одним `quality_changes`
    `UM.Settings.InstanceContainer`, формат проверен по исходнику
    `Ultimaker/Uranium`).
- Мэппинг unified→нативный ключ для Orca/Prusa process/filament — та же пара
  `(native_key, unified_path)`, что уже использует и тестирует
  соответствующий scout-парсер (инвертирована, не переизобретена и не
  угадана) — таблицы продублированы в `apps/mesh`, не импортированы из
  `apps/scout` (разные приложения монорепо, разные границы владения).
- **Честно отмеченные пробелы, не блокирующие остальное:**
  - Machine-класс покрывает только поля с подтверждённым нативным ключом
    (`printable_area`/`printable_height`/`nozzle_diameter` — Orca;
    `bed_shape`/`max_print_height`/`nozzle_diameter` — Prusa); `kinematics`/
    предельные температуры/`extruder_type` не экспортируются — нет
    подтверждённого 1:1 нативного ключа, гадать формат запрещено принципами
    зоны (см. докстринг модуля).
  - Cura-экспортёр machine-геометрию не пишет вообще (нужен отдельный
    контейнер `definition_changes`, не `quality_changes` — следующий шаг).
  - Набор ключей `[values]` у Cura подтверждён фетчем `fdmprinter.def.json`
    только частично (machine-геометрия, `layer_height*`, `wall_line_count`,
    `top_layers`/`bottom_layers`, `material_diameter`) — остальные
    (`speed_*`/`infill_*`/`material_*_temperature*`/`retraction_*`/
    `cool_fan_speed_*`) взяты из устоявшейся публичной Cura-документации, не
    пере-проверены байт-в-байт по исходнику в этом прогоне (файл слишком
    велик для надёжного полнотекстового фетча в этой сессии).
  - `setting_version` Cura (внутренний номер ревизии формата) — заглушка
    `CURA_SETTING_VERSION_PLACEHOLDER=25`, параметризуема; точное значение
    для целевой версии Cura не найдено без живого инстанса — калибровка
    входит в шаг 2 (CI-валидация реальным импортом).
- `pytest`/`ruff check` зелёные (8/8 новых тестов, включая round-trip
  структурных проверок значений/секций и негативные кейсы на пустые
  params/geometry).
- **Не сделано этим прогоном** (шаг 2 фазы 3 — CI-валидация реальным
  импортом на связках ≥50 принтеров × 3 материала): не начато. Нужны headless
  OrcaSlicer/PrusaSlicer/Cura CLI в CI-раннере GitVerse Actions (провижининг —
  заявка Ops, ни один из трёх бинарей в этом окружении недоступен, проверить
  синтаксическую корректность живым импортом в этом прогоне нельзя) + список
  реальных связок принтер×филамент из каталога для прогона. Также не начата
  систематическая доливка `machine`-класса в `slicer_profiles` (см. пункт
  «Не сделано» ниже, актуален и для этого шага — без неё `build_orca_bundle`/
  `build_prusa_bundle` берут geometry из каталога `machines`, а не из
  `slicer_profiles`, что честно, но означает отсутствие native-специфичной
  machine-дельты в экспорте).

**Обновление (MF-1918, 2026-07-18, Ops):** блокер провижининга снят — headless
OrcaSlicer `v2.4.2`/PrusaSlicer `2.7.2+dfsg`/Cura `5.13.0` доступны в CI
(`.gitverse/workflows/ci.yaml` job `python`, leg `mesh`), версии и живая
проверка реальным импортом — `docs/infra/slicer.ci.headless.md`. Реальный
импорт в этой карточке уже нашёл конкретный дефект: `build_orca_bundle` не
проставляет compatible-linkage между `process.json` и `printer.json` —
OrcaSlicer CLI реально отклоняет связку (`process not compatible with
printer`). Список реальных связок ≥50 принтеров × 3 материала и сам
CI-гейт (плюс Cura-парсинг через Uranium, сейчас не пройден) — по-прежнему
не сделаны, следующий шаг Mesh/Test, не Ops.

**Обновление (MF-1919, 2026-07-18, Mesh):** `build_orca_bundle` теперь
проставляет `compatible_printers` (массив с `name` printer-пресета) и в
`process.json`, и в `filament.json` — формат подтверждён реальным
фикстур-файлом `apps/scout/tests/fixtures/orca_filament_generic_pla.json`
(`"compatible_printers": ["Creality Ender-3 V2 0.4 nozzle"]`), не по догадке.
Это правильная и достаточная линковка для реального GUI-импорта (Orca
`is_compatible_with_printer` в `src/libslic3r/Preset.cpp` сравнивает
`compatible_printers` с ИМЕНЕМ активного printer-пресета — точное
совпадение). `pytest`/`ruff` зелёные (9/9, +1 новый тест). Commit `7f6be89`
на `dev`.

**Живая проверка реальным бинарём (Mesh, 2026-07-18, тот же прогон MF-1919,
пиненная версия OrcaSlicer v2.4.2 из MF-1918, sha256 сошёлся) нашла ВТОРОЙ,
более глубокий дефект**, отдельный от исправленного выше: CLI-путь
`--load-settings "printer.json;process.json" --export-3mf` (именно этим
путём воспроизвёл ошибку MF-1918) использует НЕ `is_compatible_with_printer`
(GUI-путь), а отдельную более узкую проверку в `CLI::run`
(`src/OrcaSlicer.cpp`, ~строка 2600): она сравнивает `compatible_printers`
процесса не с ИМЕНЕМ printer-пресета, а с его `inherits` ("system name").
Для полностью синтетического (не из каталога вендоров) `printer.json` с
`from: "user"` и пустым `inherits` эта проверка НЕ МОЖЕТ пройти —
`new_printer_system_name` всегда `""`, а класть туда `[""]` в
`compatible_printers` сломало бы реальную GUI-совместимость (пустая строка
никогда не совпадёт с именем реального принтера пользователя — see выше).
Эмпирически подтверждено (реальным бинарём, не догадкой): если
`printer.json.inherits` = собственному `name` пресета (self-reference),
CLI-путь проходит и реально экспортирует валидный `.3mf`
(`compatible 1`, `Project exported to ...`).

**Применено этим прогоном (Mesh, 2026-07-18, продолжение MF-1919):** синтетический
якорь `inherits` (детерминированная строка `f"3mf.tech printer link — {printer_name}"`,
не self-reference на собственный `name` — отдельная строка, чтобы не заводить буквальный
preset→сам-себе цикл) проставлен в `printer.json`; `process.json`/`filament.json`
ссылаются на тот же якорь через `compatible_printers`. Перепроверено живым импортом
на пиненном `orca-slicer` v2.4.2 (тот же бинарь MF-1918) **худшим случаем** — принтер с
именем, заведомо не совпадающим ни с одним из ~133 вендоров, зашитых в этот билд
(кириллица, `"Мой Кастомный Принтер РФ 9000"`): `--load-settings "printer.json;
process.json" --load-filaments filament.json --export-3mf ... /tmp/cube.stl` даёт
`compatible 1`, `exit=0`, реальный `.3mf` с сохранёнными `layer_height`/`wall_loops`/
`sparse_infill_density`/`nozzle_temperature`/`printable_height` (вскрыт и проверен байт-в-байт
из `Metadata/project_settings.config`). `pytest`/`ruff` зелёные (9/9 `test_slicer_profile_export.py`,
включая обновлённый тест на linkage через `printer["inherits"]`, а не `printer["name"]`).

**Открытый остаточный риск** (честно, как и предыдущая запись выше): поведение
несуществующего `inherits`-якоря при полном GUI-импорте (`Add printer`/`Import Config`,
не headless `--load-settings`) этим прогоном не проверено — нет живого GUI/DISPLAY в
среде агента. По логам headless-прогона парсер не выдаёт предупреждений о
неразрешённом родителе (`inherits`) ни для одного из протестированных вариантов
(частичный вендорский base, произвольная синтетическая строка, self-reference) — что
косвенно говорит о штатной обработке отсутствующего родителя (сценарий "поделились
конфигом без общего базового профиля" — обычное дело для реальных пользователей
Orca), но это не заменяет живую проверку в самом GUI. **Вывод для следующего шага
(CI-гейт реальным импортом, ещё не начат):** headless-гейт (`--load-settings
printer;process --export-3mf`) теперь проходит для произвольного (не только
каталожного) принтера — блокер снят; живая GUI-проверка `inherits`-якоря — вне
бюджета headless CI и не входит в объём этой карточки. Список связок ≥50×3 и сам
CI-гейт по-прежнему не сделаны.

## CI-гейт реальным импортом ≥50×3 связок (Mesh, 2026-07-18, MF-1920 — закрывает шаг 2 фазы 3 MF-413)

Три вещи, оставленные MF-1919 «следующему шагу» (см. блок «Живая проверка
реальным бинарём» выше), сделаны и залиты на `dev` этим прогоном:
`apps/mesh/src/mesh/slicer_ci_corpus.py`, `apps/mesh/src/mesh/slicer_ci_validate.py`,
`apps/mesh/scripts/slicer_ci_gate.py` (+ тесты
`apps/mesh/tests/test_slicer_ci_corpus.py`/`test_slicer_ci_validate.py`, 15
новых проверок), гейт подключён в `.gitverse/workflows/ci.yaml` (job
`python`, шаг «CI-гейт реальным импортом ≥50×3 связок», `matrix.app == mesh`,
после провижининга MF-1918).

**1. Метод CLI-валидации Orca (решение открытого вопроса MF-1919) — и
находка регресса в самом прогоне.** Первая идея (self-reference
`printer.json.inherits = printer.name`, применённая ТОЛЬКО в CI-only копии
bundle, продовый `build_orca_bundle` не тронут) реально работала —
`compatible 1`, валидный `.3mf`. Но пока эта карточка писалась, параллельно
на `dev` прилетел коммит `0665c9e` (тоже Mesh, тоже MF-1919, независимая
сессия) с ДРУГИМ фиксом ТОЙ ЖЕ проблемы прямо в продовом
`build_orca_bundle`: синтетический якорь `printer.inherits = "3mf.tech
printer link — {name}"`, на который `compatible_printers` process/filament
стал ссылаться ВМЕСТО `printer.name`. После rebase на этот коммит гейт
внезапно покраснел на живом прогоне (`compatible 0` там, где раньше было
`compatible 1`) — расследование показало: `compatible_printers` больше не
содержит `printer.name`, а `is_compatible_with_printer` (GUI-путь,
`src/libslic3r/Preset.cpp`, установлено ПЕРВЫМ прогоном MF-1919, см. блок
выше) сравнивает именно по имени — т.е. коммит `0665c9e` реально чинил
headless CLI ЦЕНОЙ регресса настоящего GUI-импорта (пресеты перестали бы
считаться совместимыми в реальном Orca при обычном File → Import),
задокументированного как «открытый остаточный риск» в самом коммите, но не
опознанного как конкретно ЭТА поломка.
**Исправлено этим прогоном** (`slicer_profile_export.py`,
`_orca_compatible_printers`): `compatible_printers = [printer.name, якорь]`
— оба значения в одном массиве, GUI и headless CLI читают один список
независимо и каждый находит своё совпадение. Живым прогоном подтверждено:
`compatible 1`, `printer.name` присутствует в `compatible_printers`
байт-в-байт. Гейт (`validate_orca_import`) теперь валидирует РОВНО продовый
`build_orca_bundle` без CI-only модификаций — самой нужды в проксировании
`inherits` больше нет, т.к. прод-бандл проходит headless CLI из коробки.

**2. Cura — реальный импорт без Uranium.** Открытый гэп MF-1918/1919
("headless PyQt6/Nuitka-фриз AppImage не даёт запустить произвольный
Python-скрипт, системный python3.12 падает сегфолтом на несовпадении ABI")
закрыт ДРУГИМ путём, не тем, что искали: `CuraEngine` — отдельный C++ CLI
слайсер-бэкенд внутри того же AppImage (`CuraEngine slice -j
fdmprinter.def.json -s key=value ... -l model.stl -o out.gcode`,
задокументированный режим, не догадка), полностью независимый от Qt/Python-
фронтенда. Полный резолв дефолтов `fdmprinter.def.json`/`fdmextruder.def.json`
(рекурсивный обход `children`, `_collect_defaults`) + оверрайд нашими
`[values]` из `.curaprofile` → реальный g-code (подтверждено: ~2000 команд
перемещения, температуры совпадают с оверрайдом). Сам бинарь `CuraEngine`
нельзя запустить напрямую внутри распакованного AppImage — его ELF
`PT_INTERP` относительный (резолвится только через `AppRun`), а `DT_RUNPATH`
зашит абсолютными путями conan-кэша build-машины GitHub Actions. Обход —
явный вызов системного `ld.so --library-path <appdir>` (приоритет
`LD_LIBRARY_PATH`/`--library-path` над `DT_RUNPATH` — стандартный порядок
резолва glibc), без патчей бинаря и без FUSE.

**3. Корпус ≥50×3 связок — реальные вендорские данные, не БД.** CI-джоба
`python` не поднимает Postgres для `matrix.app == mesh` (в отличие от
node-джобы) — заводить его только ради выборки готового списка связок было
бы лишней инфраструктурой для этой карточки. Вместо `slicer_profiles`/
`machines` корпус читает НАПРЯМУЮ из уже распакованного бандла OrcaSlicer
(тот же апстрим `SoftFever/OrcaSlicer` `resources/profiles/`, который парсит
`apps/scout` в канон) — вендор Creality: 100 самодостаточных (не-дельта)
инстанцируемых machine-пресетов + полные (не-дельта) `fdm_filament_{pla,
petg,abs}.json` с конкретными температурами/плотностью. Гейт по умолчанию
берёт первые 50 (алфавитный порядок имени файла, детерминированно) × 3
материала = 150 связок; лимит параметризуется
(`MESH_SLICER_CI_PRINTER_LIMIT`). Реальная находка при первом прогоне на
полном наборе: часть вендорских `printable_area` хранит 4 угловые точки
ОДНОЙ строкой через запятую (`"0x0,220x0,220x220,0x220"`), не JSON-списком
из 4 строк, как в файле-примере, использованном при проектировании
экспортёра (MF-413 шаг 1) — обе формы теперь нормализуются одинаково
(`machine_from_orca_printer_json`).

**Живой прогон полного корпуса (2026-07-18, реальные бинари v2.4.2/2.7.2/
5.13.0, тот же прогон):** 50 принтеров × 3 материала = 150 связок, **150/150
прошли реальный импорт во все три слайсера** (450 успешных проверок:
OrcaSlicer project-merge export, PrusaSlicer `--export-gcode`, CuraEngine
`slice`). `pytest`/`ruff check` в `apps/mesh` зелёные.

**Готово когда (эпика, MF-413 § «CI-валидация…») — выполнено:** CI зелёный
при успешном импорте во все три слайсера на тестовом наборе связок и падает
при регрессе (гейт `sys.exit(1)` на любой упавшей связке любого слайсера,
подключённого бинаря); отчёт показывает покрытие связки×слайсер
(человекочитаемый вывод в логе шага + опциональный JSON-артефакт через
`MESH_SLICER_CI_REPORT_PATH`).

**Не сделано этим прогоном:** живая проверка `compatible_printers = [name,
якорь]` в реальном (не headless) Orca GUI не выполнена — нет
живого DISPLAY в среде агента, тот же класс остаточного риска, что
`0665c9e` честно пометил для одного якоря; для двух значений в списке риск
объективно ниже (`printer.name` — то самое значение, что GUI-путь
сравнивал и проходил ДО коммита `0665c9e`), но не заменяет живую проверку;
корпус — один вендор (Creality), не полный каталог `slicer_profiles`
(10120 строк на `dev`) — расширение на другие вендоры/на реальный
`machines`/`slicer_profiles` каталог, когда CI-джоба `python` заведёт свой
Postgres-service (по образцу node-джобы) или появится offline-снапшот
каталога, пригодный для CI без сети к прод-БД.

## v2: AI-движок дельт над детерминированным подбором (giga, 2026-07-18, MF-1941 — стадия 4/2 эпика MF-34)

Контекст: v1 (детерминированный движок MF-412 + экспорт MF-413) — done. v2
добавляет AI-слой поверх детерминированного профиля: тонкая донастройка
(flow ratio/охлаждение/ретракт/PA/скорости) с русским обоснованием и
confidence. Реализация — зона AI, `apps/giga/src/giga/slicer_ai/`, НЕ Mesh/api
(границы CLAUDE.md).

- **Эндпоинт** `GET /slicer-profiles/:printerId/:filamentId/ai-delta` —
  контракт `slicer.ai-delta.v1` (`docs/contracts/slicer.ai-delta.v1.md`),
  внутренний (вызывается `apps/api`, auth/rate-limit уже пройдены на его
  стороне).
- **Клэмпинг по паспорту принтера — переиспользован, не изобретён заново**,
  как прямо требует карточка: `giga/slicer_ai/matcher_port.py::clamp_to_passport`
  — документированный Python-порт `apps/api/src/slicerProfiles/
  matcher.ts::clampToPassport` (те же поля/формулы/пороги; литеральный шаринг
  кода между TS/Python невозможен — `apps/api`/`apps/giga` интегрируются
  только через общий `DATABASE_URL`, см. докстринг модуля и
  `apps/giga/src/giga/catalog/__init__.py`). Весь детерминированный резолвер
  MF-412 (`matcher.ts::recommendProfile`) портирован тем же способом —
  `matcher_port.recommend_profile` — и проверен на ТЕХ ЖЕ сценариях, что
  `apps/api/src/slicerProfiles/matcher.test.ts` (`tests/
  test_slicer_ai_matcher_port.py`, 5/5), чтобы порт не разъехался с
  оригиналом молча. AI-дельты (`delta.py::build_ai_delta`) мёржатся на
  базовый профиль и ПОВТОРНО проходят эту же функцию клэмпинга — единственный
  источник safety-правил в `apps/giga`.
- **AI-слой честный при отсутствии GigaChat** (CLAUDE.md «без ключа —
  живём»): без `GIGACHAT_CREDENTIALS`, при неразбираемом JSON или значении
  ответа модели вне allow-list полей — `200` с пустыми дельтами,
  `confidence=0`, `ai.note` объясняет причину. НЕ подставляется выдуманная
  эвристическая правка вместо реального AI-предложения (принцип "не выдавать
  экстраполяцию за проверенный факт" — тот же дух, что RU-филамент-seed
  фазы 1). Allow-list полей — словарь `docs/epics/slicer.profiles.md` §
  «Словарь params (v1)» выше (flow_ratio/temperature/retraction/PA/скорости),
  любой другой ключ ответа модели отбрасывается ДО мёржа.
- **Промпт — файл, не строка в коде** (`slicer_ai/prompts/delta.system.md`,
  принцип "промпты — это код"), температура GigaChat зафиксирована `0.0`
  (`gigachat_client.ask_text` получил опциональный параметр `temperature`,
  необязательный — остальные вызывающие ветки не затронуты).
- **Обучающий сигнал (MF-1940) — реально подключён, данных пока 0 строк.**
  MF-1940 закрылась (миграция `20260718230000_slicer_profile_calibrations.sql`)
  ПОКА эта карточка писалась — `db.calibration_signal_available` (существование
  таблицы через `to_regclass`, не падает, если её нет) дополнена
  `db.fetch_calibration_summary(conn, machine_id, material_id)`: реальный
  агрегат (count success/defect, `avg(flow_ratio)`, `avg(pressure_advance)`)
  по связке printer×filament, `None` если записей ещё нет (штатно на `dev` —
  MF-1940 задеплоена только что, 0 строк). Агрегат передаётся моделью
  GigaChat в промпт (`calibration_signal` в контексте, `slicer_ai/prompts/
  delta.system.md` явно просит опираться на него сильнее общих принципов
  FDM, если он не `null`) и в ответе эндпоинта (`calibration_signal`,
  `docs/contracts/slicer.ai-delta.v1.md`). Это ровно то, что MF-1940 сама
  назвала "консюмер поверх новой таблицы — не эта карточка" (`docs/epics/
  slicer.profiles.md` § «Обучающий сигнал (v2, MF-1940)» выше) — консюмер
  и есть эта карточка.
- **A/B-сравнение — экспертная эвристика на golden-наборе, честно
  задокументировано почему.** Реальных калибровочных данных на `dev` пока 0
  строк (см. выше — таблица только что задеплоена), метрика на факте исхода
  печати физически невозможна ЭТИМ прогоном. Карточка прямо разрешает
  "экспертную оценку на старте, если сигнала ещё нет", поэтому метрика
  (`tests/golden/slicer_ai_scoring.py::score_plausibility`) — доля
  предложенных AI полей, укладывающихся в общеизвестные безопасные диапазоны
  настройки FDM (flow ratio 0.85-1.15, PA/K-factor 0-1.2, ретракт 0.2-10мм/
  10-80мм/с, z-hop 0-1мм — не выдуманные числа, общепринятые границы, см.
  докстринг). `tests/test_slicer_ai_eval.py::test_ab_comparison_on_golden_set`
  гоняет 3 golden-связки (точное совпадение Creality+PLA, точное совпадение
  CoreXY+PETG со сменой intent, RU-принтер+RU-филамент с экстраполяцией) через
  MF-412-эквивалентный `base` и AI-слой на скриптованном (не живом) GigaChat-
  клиенте, печатает A/B (confidence/changed_fields base vs ai), проверяет
  правдоподобие == 1.0. Второй тест
  (`test_real_gigachat_ab_comparison_on_golden_set`) на том же наборе, но с
  реальным GigaChat — `skipif` без `GIGACHAT_CREDENTIALS`, прогонится
  по-настоящему на VDS/окружении с кредами (тот же паттерн, что
  `test_embed_quality_eval.py`/`test_search_quality_eval.py`).
- **Честное ограничение этого прогона:** golden-набор — СИНТЕТИЧЕСКИЕ
  фикстуры (представительные для реального корпуса `slicer_profiles` —
  вендор Creality/материалы Generic PLA-PETG-ABS, те же, что CI-корпус
  MF-1920/парсер Step 2 фазы 1 MF-411), НЕ живой прогон против `dev`-БД: у
  этой сессии нет `DATABASE_URL`/сетевого доступа к дев-Postgres и
  `GIGACHAT_CREDENTIALS` ("живём без ключа"). "≥1 набор РЕАЛЬНЫХ связок" из
  критерия приёмки карточки в буквальном смысле (id из каталога `dev`) — не
  выполнено этим прогоном, требует сессии с доступом к `DATABASE_URL`
  (VDS/Ops-периметр) — следующий шаг, не выдаётся здесь за сделанное.
- `pytest`/`ruff check` в `apps/giga` зелёные: 196 прошли (3 предсуществующих
  падения `test_branches_openscad.py` — отсутствие бинаря `openscad` в PATH
  этого окружения, не связаны с этой карточкой), 2 `skip` (реальный GigaChat
  — ожидаемо без кредов).

**Не сделано этим прогоном:** живой прогон против реального `dev` (`slicer_profiles`/`machines`/`materials` по настоящим id, реальный вызов GigaChat) — блокер: нет `DATABASE_URL`/`GIGACHAT_CREDENTIALS` в этой сессии; метрика A/B на факте исхода печати вместо экспертной эвристики — блокер: на `slicer_profile_calibrations` пока 0 строк (MF-1940 задеплоена только что), нечего агрегировать; регистрация вызова этого эндпоинта из `apps/api` (объединение `slicer.profile-recommendation.v1` + `slicer.ai-delta.v1` в одном ответе для фронта) — вне зоны AI, следующая карточка Back/Fullstack.

## Отправка профиля на принтер через relay v1

Исторический one-shot transport MF-1942 удалён вместе с unversioned relay ingress. Активный
путь не отправляет полный base64-файл в синхронном HTTP-запросе:

- API резолвит profile bundle, сохраняет private immutable object и создаёт
  `device_transfers(kind='printer_profile', start_print=false)`;
- Nest relay обнаруживает pending transfer через canonical session authorize/heartbeat,
  запрашивает metadata и короткоживущий version-bound HTTPS URL через
  `/internal/relay/v1/transfers/*`;
- relay читает bounded byte ranges, отправляет canonical `file_start`/`file_chunk` и
  сохраняет agent-confirmed offset; reconnect или URL expiry продолжают transfer с этого offset;
- device-agent проверяет kind/extension/size/SHA-256, пишет spool и загружает профиль в
  Moonraker `config`; `printer_profile` не может запустить печать.

Тестовый gate включает contracts, Nest relay transfer suite/compiled interop,
device-agent `fileTransfer.test.ts` и API transfer repository/object-store tests. G-code
generation/deployment и OrcaSlicer/Cura profile resolution остаются отдельными product/Ops
границами и не следуют автоматически из transport readiness.

## Snapmaker U1 — реальный Orca-профиль и headless-слайс (Mesh, 2026-07-19, MF-1974)

Первый РЕАЛЬНЫЙ headless-слайс (не только импорт-валидация, MF-1920) в этой
кодовой базе — `--slice 0 --export-3mf` встраивает в `.3mf` настоящий toolpath
(`Metadata/plate_N.gcode`) и метрики (`Metadata/slice_info.config`), не только
проверку синтаксической совместимости бандла. Первый кейс — печатные
артефакты SO-101 follower (пиненный коммит `TheRobotStudio/SO-ARM100`).

- **Источник профиля — реальный вендорский бандл Orca, не реконструкция.**
  Snapmaker U1 официально поддержан самим OrcaSlicer (`resources/profiles/
  Snapmaker/machine/Snapmaker U1*.json`, та же пиненная `v2.4.2`, что CI
  провижинит с MF-1918) — `apps/mesh/src/mesh/snapmaker_u1_profile.py` резолвит
  реальную inherits-цепочку `Snapmaker U1 (0.4 nozzle)` (machine) / `0.20
  Standard @Snapmaker U1 (0.4 nozzle)` (process) / `Snapmaker PLA @U1`
  (filament) — тот же паттерн источника, что `slicer_ci_corpus.py` (читает
  распакованный AppImage напрямую, не БД), НЕ путь `slicer_profile_export.
  build_orca_bundle` (тот — generic-реконструкция произвольного принтера
  каталога `machines` с синтетическим compatible-linkage якорем). Живой
  паспорт подтверждён: `printable_area` 270×270мм, `printable_height`
  270.05мм, `gcode_flavor: klipper` — `resolve_snapmaker_u1_profile` кидает
  честную ошибку, если вендорский бандл вдруг разойдётся с этим паспортом
  больше чем на 1мм (не тихо съедает расхождение). `content_hash` —
  sha256 канонической сериализации резолвленной тройки, воспроизводим
  (проверено повторным резолвом в тестах).
- **Multi-toolhead U1 — явно не симулируется.** Базовый machine-профиль
  Orca (`fdm_U1`) наследует `fdm_toolchanger` (4 реальных toolhead) — эта
  карточка ограничена single-material печатью через toolhead `0`;
  `slicer_preflight.check_single_toolhead` отклоняет любой другой индекс с
  понятным кодом `UNSUPPORTED_TOOLHEAD`, маппинг деталь→toolhead не
  угадывается.
- **Preflight (`apps/mesh/src/mesh/slicer_preflight.py`) — до вызова
  слайсера, не вместо его собственных проверок.** `check_bed_fit` (стол
  270×270×270 + опциональный clearance), `check_units` (честный отказ на
  не-мм), `check_single_toolhead`, `check_profile_hash` (протухший
  зафиксированный профиль). Дополняет, не заменяет: реальный `orca-slicer`
  САМ отклоняет collision (проверено живьём — куб 300×100×50мм под U1-
  профилем даёт реальный `exit=206`, "run found error", без файла на диске),
  preflight — дешёвый структурированный отказ раньше, не полагается только на
  парсинг чужого `stderr`.
- **Реальный headless-слайс (`slicer_engine.py`: `run_orcaslicer`/
  `slice_with_orca_cli`, `snapmaker_u1_slice.py`: `slice_snapmaker_u1`).**
  `run_orcaslicer` — продовый вход, тот же `systemd-run --user --scope`
  cgroup-паттерн, что `run_prusaslicer` (MF-989); `slice_with_orca_cli` —
  прямой вызов без cgroup-обёртки (тот же уровень, что `slicer_ci_validate.
  validate_orca_import`, MF-1920) — нужен, потому что в этой песочнице (и,
  вероятно, части CI-раннеров) нет пользовательской systemd/dbus-сессии
  (`systemd-run --user` падает `Failed to connect to bus`) — тот же класс
  ограничения, из-за которого `run_prusaslicer` тоже нигде не гоняется живым
  бинарём в этом репозитории, только через monkeypatch. Метрики парсятся из
  РЕАЛЬНОГО вывода Orca (`Metadata/slice_info.config`), не оцениваются мешем:
  `prediction` (секунды печати), `used_g`/`used_m` (расход филамента),
  `skipped="true"` на объекте → предупреждение, не тихий частичный успех.
- **Живой прогон на реальном корпусе SO-ARM100** (пиненный коммит
  `fda892cba81032c46c40976a48c9ceadbf40a9ca`, Apache-2.0, `apps/mesh/tests/
  so101_corpus.py` — sha256 каждого файла зафиксирован в коде, не только
  коммит; тот же принцип "скачать по пиненному адресу и сверить хэш", что
  CI-провижининг бинарей слайсеров, MF-1918, файлы НЕ закоммичены в git,
  тот же прецедент "нет committed бинарных фикстур в `apps/mesh`", что весь
  остальной корпус тестов этого приложения). **Набор и порядок acceptance-
  артефактов зафиксированы оператором в карточке (2026-07-19)** и совпадают
  с примером `artifacts:` в `docs/product/project.as.code.md` §
  «Как агент оформляет реальные этапы» (`gauge-loose`/`follower-plate`,
  тот же `upstream.commit`):
  - **`STL/Gauges/Gauge_0.STL`** (`gauge_loose`, 1766 треугольников, bbox
    51×35×10мм) → реальный `.gcode`, `prediction=670с` (~11мин),
    `used_g=4.81`, `used_m=1.61`, без предупреждений.
  - **`STL/Gauges/Gauge_tight_1.STL`** (`gauge_tight`, 416 треугольников,
    bbox 51×35×10мм) → реальный `.gcode`, `prediction=676с` (~11мин),
    `used_g=4.81`, `used_m=1.61`, без предупреждений.
  - **`STL/SO101/Follower/Ender_Follower_SO101.stl`** (`follower_plate`,
    96584 треугольников, bbox 216×215×87мм — реально помещается в стол U1
    270×270 без clearance) → реальный `.gcode`, `prediction=39380с` (~10.9ч),
    `used_g=302.0`, `used_m=101.26`, без предупреждений.
  - **300×100×50мм синтетический куб** (заведомо больше стола по X) —
    preflight отклоняет `OUT_OF_BED` ДО вызова слайсера; отдельным тестом
    подтверждено, что и сам `orca-slicer` (без preflight) реально отклоняет
    ту же деталь (`SlicingError`, ненулевой exit, файл не создан) — двойное
    подтверждение, preflight не единственная линия защиты.
  - Живой прогон воспроизведён этим прогоном на реальном бинаре `orca-slicer`
    v2.4.2 (`/tmp/orca_extract` — тот же extract, что CI делает через
    `--appimage-extract`) — не заглушка/мок.
- **Контракт входного контекста «artifact→slice» (оператор, 2026-07-19)** —
  переход из build session/проекта в слайсер несёт immutable-контекст
  `project revision + configuration digest + workflow step id + artifact id`
  (дословно, `docs/product/project.as.code.md` § «Печатный шаг и слайсер»),
  НЕ общий per-проектный `preview_url` — иначе слайсер не может отличить,
  какая именно версия/конфигурация/деталь запрошена. Эта карточка (Mesh)
  резолвит УЖЕ ИЗВЛЕЧЁННЫЙ файл (STL/3MF байты конкретного artifact) в
  G-code — извлечение байт artifact ИЗ (revision, digest, step id,
  artifact id) — это резолвер выше по конвейеру (`труба` — Back/API, не
  территория Mesh, см. границы зоны CLAUDE.md). Явно НЕ реализовано этим
  прогоном: сам API-эндпоинт/резолвер artifact→байты — следующий шаг
  Back/Fullstack, не подменяется здесь угадыванием чужой границы.
- **CI-провижининг (`--load` env, MF-1918) дополнен** `MESH_ORCA_PROFILES_DIR`
  (путь до `resources/profiles` того же извлечённого AppImage) — без него
  живые тесты `test_snapmaker_u1_*.py` тихо скипаются в CI так же, как
  локально без явного экспорта.
- **Тесты:** `test_slicer_preflight.py` (21, чистая логика, без бинаря),
  `test_snapmaker_u1_profile.py` (7, синтетический inherits-корпус +
  1 живая проверка реального вендорского бандла, skip без
  `MESH_ORCA_PROFILES_DIR`), `test_slicer_engine_orca.py` (13, парсинг
  `slice_info.config`/systemd-run-обёртка на синтетических `.3mf`, без
  бинаря), `test_snapmaker_u1_slice.py` (5 — 2 gauge параметризованы +
  follower_plate + 2 out-of-bed, живой `orca-slicer` на реальном корпусе
  SO-101, skip без `MESH_ORCA_SLICER_BIN`+`MESH_ORCA_PROFILES_DIR` или сети).
  Полный `pytest` — 277 passed, 9 skipped (skip только там, где нет живого
  бинаря/сети — не считается "не сделано", см. живой прогон выше), `ruff
  check .` чистый.

**Честно не сделано этим прогоном (следующие шаги):**
- **DB-driven диспетчер `slicing_queue.py`** (переключение
  `resolve_prusa_ini`/`run_prusaslicer` → Orca-эквивалент по
  `slicer_profiles.slicer` внутри `process_one_slice_job`) — НЕ сделано:
  текущая схема `slice_jobs` несёт только `profile_id`/`filament_profile_id`
  (два id), без отдельного поля под machine-геометрию, которую Orca требует
  отдельно от process/filament (в отличие от Prusa INI, где недостающая
  геометрия молча подразумевается активным принтером). Дописывать резолвер
  под предположение о недостающем контракте значило бы гадать схему —
  запрещено принципами зоны; нужно согласование с Data/Back (владельцы
  `slice_jobs`/`machines`) о том, как машина попадает в джобу. Сегодняшнее
  поведение уже честное (профиль `orcaslicer` в очереди даёт `failed` с
  понятной причиной от `resolve_prusa_ini`, не ложный `ready`) — это не
  регрессия, просто ещё не РЕАЛЬНЫЙ Orca-путь через очередь.
  `slice_snapmaker_u1`/`run_orcaslicer` в этой карточке — готовый, живо
  проверенный строительный блок для этого диспетчера, не сам диспетчер.
- **`slice_key`/`slice_cache_entries` для Orca-джоб** — зависит от пункта
  выше (нет диспетчера — некуда класть кэш-запись); `SnapmakerU1SliceResult.
  profile_content_hash` — честная замена на уровне этой карточки (входит в
  тот же sha256, что нужен `compute_slice_key`), не подключена к самой
  `slice_cache_entries`.
- **Preview/plate projection** (GLB/webp превью слайса) — отдельная
  контурная задача (MF-471, рендер), не эта карточка; результат этой
  карточки — G-code + метрики + warnings, без визуального превью.
- **Каталожная запись Snapmaker U1** (`apps/web/src/printers/fixtures.ts` —
  сейчас есть только `snapmaker.j1`) — Front-территория, не тронуто.
- **Multi-toolhead mapping** (деталь→конкретный из 4 toolhead U1) —
  сознательно не реализовано и не симулировано, см. `check_single_toolhead`
  выше; печать только через toolhead `0`.
- **Live evidence на `dev.3mf.tech`** — этот прогон не трогает API/веб-контур
  (труба — Back, см. границы зоны CLAUDE.md), только `apps/mesh`-содержимое;
  live-доказательство здесь — реальный `orca-slicer` v2.4.2 на реальном
  корпусе SO-101 (см. выше), не HTTP-эндпоинт.

## Не сделано (следующие шаги, не эта карточка)

- **Полный каталог вендоров OrcaSlicer** (133 всего, залито 16 крупных) — доливка тем же `scout-slicer-print-profiles-agent --vendor <name>`, не блокер для MF-412 (данных уже с большим запасом).
- **Cura per-printer quality-профили** (`resources/quality/<printer>/...`, реальные вендор-специфичные настройки печати за пределами 7 глобальных generic-тиров) — сознательно не пройдены этим прогоном, объём на порядки больше бюджета одного прогона (сотни принтеров × нозл × материал × тир), можно долить отдельным заходом при появлении потребителя, которому важна именно per-printer точность Cura (не блокер MF-412 — Orca/Prusa/Cura-generic уже дают избыточное покрытие).
- **Систематическая доливка `machine`-класса** в `slicer_profiles` (уже частично есть аналог в `machine_candidates`, но не в унифицированной схеме этой карточки) — geometry-поля (build_volume/kinematics) сознательно не тронуты этим прогоном, чтобы не гадать по неполным данным (кинематика не всегда однозначно выводима из JSON источника).
- **RU-принтеры** (эпик п. «RU-специфика» — не только филаменты) — `machine_candidates`, не `slicer_profiles`, вне unified-схемы этой карточки; сделаны и залиты на `dev` отдельной карточкой [MF-1803](mention://issue/265acfb9-949c-49a5-aa14-a0e5bc6830e5) (Back), см. § «RU-принтеры (machine_candidates)» ниже.
- **Планировщик на VDS** — deploy-юниты `portal.scout-slicer-print-profiles.{service,timer}`/`portal.scout-slicer-print-profiles-prusa.{service,timer}`/`portal.scout-slicer-print-profiles-cura.{service,timer}` добавлены в репо по образцу `MF-719`, но включение (`systemctl enable --now`) — заявка Ops, не сделано этим прогоном (данные на `dev` уже залиты вручную одноразовыми прогонами).
- **Рекомендательный API MF-412** — сделан маршрут `GET /slicer-profiles/:printerId/:filamentId` с детерминированным выбором ближайшего базового профиля, дельтой материала/intent, русским происхождением, confidence, экстраполяцией и паспортным клэмпингом. Генераторы экспортного формата `.orca_printer`/`.ini`/`.curaprofile` сделаны (MF-413, см. § «Экспорт в нативные форматы» выше); CI-валидация реальным импортом — ещё нет.
- **Реализация `S3_BUCKET_SLICER_PROFILES` в `apps/api/src/storage/s3.ts`** (putter/getter под bundle-файлы) — `bundle_s3_key` этим прогоном не заполняется (нет исходных bundle-файлов для заливки, только нормализованные настройки).
- **Провижининг бакета `slicer-profiles` на cloud.ru** — заявка Ops, только когда появится первый реальный bundle-файл для заливки.

## Открытые вопросы

1. **Cura↔Prusa/Orca семантика не 1:1** (эпик MF-34 § «Риски») — словарь `params` выше НЕ покрывает Cura-специфичные концепции (`quality_type`, `intent`, многослойный container-stack override). Cura-парсер (Step 3, готово 2026-07-17) держит Cura-специфичные поля вне словаря — `additionalProperties: true` разрешает добавить их позже без ломки схемы, до появления реального потребителя-экспортёра, которому `quality_type`/`intent` будут нужны как канонические поля.
2. **Ациклия `inherits_id`/`extrapolated_from_id` за пределами прямого self-reference** — DB-check ловит только `parent = self`, полный цикл через несколько записей не ловится констрейнтом (Postgres не умеет recursive check). Резолвер (MF-16) обязан быть устойчив к циклу (глубина обхода с лимитом) — не блокер этой схемы, но задокументировать в реализации резолвера.
3. **Юр. чистота переиспользования AGPL/GPL-профилей как данных** (эпик § «Риски») — `license` на каждой записи фиксирует факт, но юридическую оценку допустимости (переиспользование профиля-как-данных vs копирование кода слайсера) эта карточка не проводит — вне компетенции Data.
4. **PrusaSlicer multi-parent inherits (`A; B`) сведён к одному `inherits_id`** — резолвер (MF-16) при чтении цепочки Prusa-профилей получит только primary-родителя; поля secondary-миксина (напр. `*soluble_support*`) не будут смёрджены на чтении, хотя физически применялись бы в самом PrusaSlicer. Не блокер (secondary-миксины редки — support-варианты), но резолвер должен это знать, если для конкретной связки печать выглядит «недокомплектной» относительно оригинального .ini.
5. **Retraction settings у Prusa — per-printer, не per-filament** (в отличие от Orca/Cura, где ретракт — часть filament-профиля) — `slicer_profiles.filament` для `prusaslicer` не содержит `retraction_length_mm`/`retraction_speed_mm_s`/`z_hop_mm` в принципе, экспортёр (MF-413) должен брать эти поля из machine-класса при генерации `.ini`-бандла для Prusa, а не ждать их в filament-дельте.

## Обучающий сигнал (v2, MF-1940)

**Статус:** схема+API задеплоены (Data), 2026-07-18 — стадия 4 эпика MF-34, первый шаг v2
«обучающий сигнал». До этой карточки данных не было вообще: RU-filament seed из § «RU-специфика»
выше явно помечен `extrapolation_reason` как «placeholder до появления реального калибровочного
сигнала (эпик v2: калибровки/Make-фидбэк)» — эта карточка заводит то самое хранилище.

**Что сделано:** таблица `slicer_profile_calibrations` (append-only ledger, тот же принцип, что
`uploader_reputation_ledger`) — калибровочные значения связки printer×filament (`flow_ratio`,
`pressure_advance`) + исход печати (`outcome` success/defect, опциональный `defect_type`), с
обязательной привязкой на `slicer_profile_id`/`machine_id`/`material_id` и опциональной —
на `model_id` и на запись Make-галереи (`make_id`). API: `POST /slicer-profiles/:id/calibrations`
(приём — auth, rate-limit `calibration_create`, транзакционная проверка существования
профиля/станка/материала/модели/make перед записью) и `GET /slicer-profiles/:id/calibrations`
(чтение последних 50 записей по профилю, до 50). Источник — только `source='manual'` на этом шаге
(колонка уже несёт `'telemetry'` как второе допустимое значение под будущее подключение реальной
телеметрии с устройства, без новой миграции под сам факт разных источников). Round-trip
(запись+чтение) проверен интеграционными тестами (`apps/api/src/slicerProfiles/calibrations.test.ts`)
и живьём на `dev.3mf.tech` после публикации.

**Открытый вопрос карточки закрыт честно:** Make-галерея (`docs/product/features.md` — упомянута
только как строка v2-роадмапа, без отдельной спеки) на момент этой карточки УЖЕ реализована в
коде как `makes`/`make_photos` (MF-27, MF-393/395/777/991/1793) — с рейтингом печатабельности,
issue_tags, фото и статусом публикации. Contract-стаб не заводился — вместо него `make_id` в
`slicer_profile_calibrations` опционально ссылается на существующую `makes(id)` (`on delete set
null`), проверка владения (`makes.user_id = session.id`) — на слое API.

**Не сделано этим прогоном (следующие шаги, не эта карточка):**
- **UI приёма калибровки на странице результата печати** — Front, отдельная карточка (эта
  закрывает только схему+API приёма).
- **Агрегация калибровок под AI-движок v2** (пересчёт `slicer_profiles.confidence`/подсказки по
  `flow_ratio`/`pressure_advance` на основе накопленной истории) — консюмер поверх новой таблицы,
  данных пока 0 строк на `dev` (только что задеплоено), агрегировать нечего.
- **Реальная телеметрия с принтера** (`source='telemetry'`) — вне периметра этого шага (см. текст
  карточки MF-1940), колонка/значение заведены заранее, воркер/интеграция — отдельно.

## Связанные документы/карточки

- [MF-34](mention://issue/f82bd665-798c-4c9a-a0f5-9fb65e638573) — эпик «Слайсер-профили (AI)».
- [MF-411](mention://issue/c689504d-554b-4569-b10e-12de19b7e246) — эта карточка (фаза 1).
- [MF-412](mention://issue/303ef6bd-c096-4db1-8138-4a2a0bb05b95) — детерминированный движок подбора + API (v1, done), источник порта `matcher_port.py`.
- [MF-1941](mention://issue/cafba7d1-7be2-4256-a27c-d8e509870a74) — AI-движок дельт (v2, § «v2: AI-движок дельт» выше), `docs/contracts/slicer.ai-delta.v1.md`.
- [MF-1940](mention://issue/8538f510-31a0-40e3-afd7-30e998c3c6d2) — стадия 4, v2 «Обучающий сигнал»: `slicer_profile_calibrations` + приём API, см. § «Обучающий сигнал (v2, MF-1940)» выше — зависимость для полноценного A/B из § «v2: AI-движок дельт» выше.
- `docs/epics/domain.model.md` § «Каталог станков (MF-32)» / § «Каталог филамента (MF-31)» / § «Профили печати и модификаторы (MF-402)» — соседние сущности (`machines`/`materials`/`machine_material_profiles`), на которые best-effort ссылается `slicer_profiles`.
- `docs/epics/ids.policy.md` — политика необнаружимых ID (S3-ключ строится из PK, отдельный `public_id` не нужен) + открытый конфликт с публичным offload (почему `slicer-profiles` — приватный бакет, не public-read).
- `docs/issues/007.database.design.md` — трек решений по схеме БД.
