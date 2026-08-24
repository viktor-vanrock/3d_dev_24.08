# Сервисный контракт конвертера (MF-1089)

Дополняет [`3mf.storage.md`](./3mf.storage.md) (профиль формата, эпик MF-380
«Полировка») — здесь фиксируется **контракт вызова** конвертера, коды
ошибок, enforced-лимиты и то, что уже есть по наблюдаемости. Читать перед
интеграцией с `mesh.convert`/`mesh.worker` из другого сервиса (`apps/api`)
или перед добавлением нового вызывающего кода внутри `apps/mesh`.

## Архитектура вызова: воркер и внутренний HTTP-контур

Публичного домена у `apps/mesh` нет (`docs/architecture/readme.md` § границы).
Основной production-путь для очереди — прямой вызов Python-функции из
`mesh.worker.process_one`, выполняемый в `portal.mesh-worker.service`.
Дополнительно есть внутренний `POST /convert` для вызова из приватной сети:
он не публикуется наружу и сохраняет upload на диск, поэтому не кодирует весь
3MF в JSON и не держит архив в памяти. CPU-тяжёлые фоновые задания по-прежнему
должны идти через воркер.

`mesh.main` и `portal.mesh-worker.service` — разные процессы; их in-process
метрики не объединяются (см. «Наблюдаемость»).

## HTTP-контракт `POST /convert`

Запрос — `multipart/form-data` с обязательным полем `file` и необязательными
полями `unit` (`mm` по умолчанию, также `cm`/`m`/`in`), `mode` (`repair` по
умолчанию или `strict`), `title`, `author`, `license`, `model_id`, `source`.
Upload записывается чанками; `MESH_MAX_FILE_BYTES` проверяется до разбора.

Успех — бинарный ответ `200 OK` с типом
`application/vnd.ms-package.3dmanufacturing-3mf`, `Content-Disposition:
attachment; filename="canonical.3mf"`. Структурированный JSON-отчёт лежит в
заголовке `X-Mesh-Report` и содержит `source_filename`, `unit`, `mode`, `bbox`,
`duration_ms`, `memory_peak_bytes`, `toolchain_versions` и массив `parts` с
`before`/`after` диагностикой. `X-Mesh-Metrics` содержит текущий in-process
снапшот `processed/repaired/rejected`, доли, memory peak и перцентили.

Ожидаемая ошибка — JSON с HTTP 413/422:

```json
{"error":"conversion_rejected","code":"too_large","message":"..."}
```

`code` — значение из таблицы `RejectCode`; для неверного режима используется
`invalid_mode`. Стектрейсы и внутренние пути наружу не возвращаются.

`GET /health` и `POST /make-photos` остаются отдельными контрактами.

## Точки входа

`mesh.convert`:

```python
def convert_to_3mf(
    source: Path,
    destination: Path,
    limits: Limits | None = None,
    unit: str = "mm",           # "mm" | "cm" | "m" | "in"
    mode: str = "repair",       # "repair" | "strict"
    metadata: ModelMetadata | None = None,
    thumbnail: bool = True,
) -> ConversionResult

def passthrough_3mf(
    source: Path, destination: Path, limits: Limits | None = None
) -> ConversionResult
```

- `convert_to_3mf` — вход STL/OBJ (и любой формат, который `trimesh`
  распознаёт без `force="mesh"`, см. docstring модуля) → канонический 3MF.
- `passthrough_3mf` — вход уже 3MF → структурная валидация + перекладка как
  канонический (без нормализации профиля, v0).
- Обе кидают `ConversionError` (= `mesh.errors.RejectionError`) при любом
  сбое — единый тип на весь конвейер приёма, код + сообщение (см. «Коды
  ошибок» ниже). Никогда не возвращают частичный/повреждённый результат:
  либо `ConversionResult`, либо исключение.

### `ConversionResult` (structured-отчёт)

| Поле | Тип | Что несёт |
|---|---|---|
| `path` | `Path` | Путь к записанному 3MF |
| `bbox` | `dict` | `{min, max, size, unit: "mm"}` — габарит сборки после автоориентации |
| `reports` | `tuple[PartReport, ...]` | По одному на деталь: `before`/`after` (`MeshDiagnostics`, `after=None` в `mode="strict"`) — что было почищено |
| `duration_ms` | `float` | Время конвертации (per-call метрика времени) |
| `toolchain_versions` | `dict[str, str]` | Версии `trimesh`/`lib3mf`/`manifold3d` — те же значения уже записаны в метадату выходного 3MF (`_write_toolchain_metadata`, воспроизводимость) |

## Коды ошибок (`mesh.errors.RejectCode`)

Машиночитаемые, стабильные snake_case-идентификаторы — на них ветвится
вызывающий код (`mesh.worker` сегодня просто помечает `failed`, но код
причины уже есть в исключении для будущей более тонкой обработки/алертинга).

| Код | Когда |
|---|---|
| `empty_file` | Источник пуст или не найден на диске |
| `too_large` | Размер файла превышает `Limits.max_file_bytes` |
| `truncated` | Файл обрезан (не хватает данных до конца заявленной структуры) |
| `too_many_triangles` | Треугольников после разбора больше `Limits.max_triangles` |
| `not_mesh` | Источник не даёт распознаваемой треугольной геометрии |
| `invalid_zip` | 3MF — не валидный OPC-пакет / нет обязательной части |
| `zip_bomb` | Отношение uncompressed/compressed на entry выше `Limits.max_zip_compression_ratio`, либо суммарный размер выше `Limits.max_zip_uncompressed_bytes`, либо число entries выше `Limits.max_zip_entries` |
| `path_traversal` | Entry zip-архива указывает вне распаковочной директории |
| `parse_error` | Общий сбой разбора без более точного кода (дефолт для необёрнутых `ConversionError`) |
| `timeout` | Разбор превысил `Limits.parse_timeout_seconds` в изолированном процессе |
| `memory_limit` | Разбор упёрся в `Limits.parse_memory_bytes` (RLIMIT_AS) в изолированном процессе |
| `too_expensive_to_repair` | Деталь дороже `Limits.max_repair_triangles` — отклонена по бюджету в `mode="repair"` (см. `mode="strict"` для диагностики без риска зависнуть) |
| `unknown_unit` | Флаг `unit` вне `{mm, cm, m, in}` |

## Enforced-лимиты (`mesh.limits.Limits`)

Единственное место, где живут числа — не хардкодить их повторно в другом
модуле. Дефолты рассчитаны на прод-VDS с общим бюджетом 4GB (делится с
Postgres и `apps/api`). Каждый переопределяется через env (см. `_ENV`).

| Поле | Дефолт | Env | Что ограничивает |
|---|---|---|---|
| `max_file_bytes` | 500 MB | `MESH_MAX_FILE_BYTES` | Размер входного файла на диске |
| `max_triangles` | 20,000,000 | `MESH_MAX_TRIANGLES` | Треугольников во всей сцене после разбора |
| `max_zip_uncompressed_bytes` | 1 GB | `MESH_MAX_ZIP_UNCOMPRESSED_BYTES` | Суммарный распакованный размер OPC/zip (3MF) |
| `max_zip_compression_ratio` | 100.0 | `MESH_MAX_ZIP_COMPRESSION_RATIO` | uncompressed/compressed на один entry — эвристика zip-бомбы |
| `max_zip_entries` | 10,000 | `MESH_MAX_ZIP_ENTRIES` | Число entries в zip-пакете |
| `parse_timeout_seconds` | 60.0 | `MESH_PARSE_TIMEOUT_SECONDS` | Wall-clock таймаут разбора в изолированном процессе |
| `parse_memory_bytes` | 2 GB | `MESH_PARSE_MEMORY_BYTES` | RLIMIT_AS изолированного процесса разбора |
| `max_repair_triangles` | 2,000,000 | `MESH_MAX_REPAIR_TRIANGLES` | Потолок треугольников на деталь для `mode="repair"` (дороже — `too_expensive_to_repair`) |

Разбор всегда идёт в изолированном процессе (`mesh.sandbox.run_isolated`) —
таймаут/память enforced системно (сигнал/RLIMIT), не «по договорённости»
кода. STL проходит дополнительную структурную проверку (`mesh.stl_reader`)
до передачи в `trimesh`.

## Наблюдаемость

**Per-call** (уже в `ConversionResult`, MF-380 базовый шаг):
`duration_ms`, `toolchain_versions`, `reports[].before/after` (что починено).
Версии тулчейна также запечены в метадату каждого выходного 3MF
(`_CUSTOM_METADATA_NS`, `Toolchain.*`) — воспроизводимость доступна и без
повторного чтения `ConversionResult`.

**Агрегированные метрики по потоку вызовов** (MF-1089, `mesh.metrics`):
in-process, потокобезопасный счётчик в `portal.mesh-worker.service` —
`processed`/`repaired`/`rejected`, доли `repair_rate`/`reject_rate`,
разбивка `reject_counts` по `RejectCode`, `memory_peak_bytes`, перцентили `duration_ms`
(avg/p50/p95/p99 по последним 1000 конвертациям). Сбрасывается при
рестарте процесса — это метрики текущего запуска воркера, не исторический
журнал (тот в Postgres, `models`/`model_files`). `mesh.worker` пишет
агрегированный снапшот в лог раз в 20 обработанных моделей
(`_log_metrics_periodically`).

**Важная граница процессов:** `mesh.metrics` — in-process state. Счётчик
пополняется и воркером, и `/convert` в своих процессах, но эти снапшоты не
объединяются. Общее хранилище в PostgreSQL и долгосрочная агрегация
(Prometheus) остаются вне v0.

## Не входит в этот контракт

- Публичный HTTP-эндпоинт конвертации и авторизация вызывающего — не входят в
  `apps/mesh`; `/convert` доступен только в приватном сервисном контуре.
- Полная спека-валидация 3MF (`validate_3mf` — только структурная: OPC +
  обязательные части + namespaces, не спека-инвариант) — авторитетная
  валидация MF-380 «тест-корпус+CI» происходит через `lib3mf`-чтение и
  headless-загрузку в PrusaSlicer/OrcaSlicer, отдельная задача.
