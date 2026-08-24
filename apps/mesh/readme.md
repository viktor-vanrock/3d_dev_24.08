# apps/mesh

Внутренний сервис геометрии (без публичного HTTP наружу — границы см.
`docs/architecture/readme.md`): STL/3MF-конвертация, воркер очереди
(`portal.mesh-worker.service`, поллинг Postgres). Зона агента Mesh
(`CLAUDE.md` в корне репо).

## Тулчейн (зафиксировано MF-378)

`uv.lock` — источник истины на конкретные хэши; версии основных пакетов,
разрешённые сейчас:

| Пакет | Версия | Роль |
|---|---|---|
| `lib3mf` | 2.5.0 | писатель/референсный ридер 3MF (Core+Materials+Production) |
| `trimesh` | 4.12.2 | чтение STL/OBJ, геометрия, bbox, repair (Фаза 2) |
| `numpy` | 2.5.0 | геометрия (vertices/faces), bbox |
| `manifold3d` | 3.5.2 | почти-manifold repair (используется с Фазы 2, MF-379) |

Установка (venv через `uv`, обязательно из `apps/mesh`):

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh   # если uv ещё не стоит
uv sync
```

Проверка, что весь стек реально работает вместе (STL → 3MF → чтение обратно):

```sh
uv run python scripts/smoke_3mf.py
```

Ожидаемый вывод — версии всех 4 пакетов, путь к сгенерированному 3MF, число
треугольников после обратного чтения и `СМОУК OK`. Гонять после апгрейда
любой из версий выше, до правки `mesh/convert.py`/`mesh/stl_reader.py`.

Платформа: агенты сквада работают на прод-VDS (Linux x86_64) — не macOS/M1.
Требование эпика MF-22 про universal2-wheel на arm64 относится к
гипотетическому dev на Mac; на актуальной среде (Linux VDS + CI
`ubuntu-latest`, `.gitverse/workflows/ci.yaml`) все 4 пакета ставятся как
обычные manylinux/sdist-колёса — отдельной arm64-проверки не требуется.

## Защита входа (MF-378)

Вход враждебен — файлы грузят посторонние пользователи маркетплейса.
Лимиты в одном месте, `mesh/limits.py`, переопределяются через env
(см. докстринги полей `Limits`):

| Переменная | Дефолт | Смысл |
|---|---|---|
| `MESH_MAX_FILE_BYTES` | 500 MiB | максимальный размер входного файла |
| `MESH_MAX_TRIANGLES` | 20_000_000 | максимум треугольников (до и после разбора) |
| `MESH_MAX_ZIP_UNCOMPRESSED_BYTES` | 1 GiB | максимальный суммарный распакованный размер 3MF/OPC |
| `MESH_MAX_ZIP_COMPRESSION_RATIO` | 100x | максимальное отношение uncompressed/compressed на entry (zip-бомба) |
| `MESH_MAX_ZIP_ENTRIES` | 10_000 | максимум частей в OPC-архиве |
| `MESH_PARSE_TIMEOUT_SECONDS` | 60s | wall-clock таймаут на разбор одного файла |
| `MESH_PARSE_MEMORY_BYTES` | 2 GiB | cap адресного пространства (RLIMIT_AS) процесса разбора |

Конвейер (`mesh/stl_reader.py`, `mesh/zip_safety.py`, `mesh/sandbox.py`,
подключены в `mesh/convert.py`):

- **STL**: заявленный в бинарном заголовке triangle count проверяется против
  реального размера файла и лимита ДО передачи в `trimesh` — переполненный/
  усечённый/пустой файл отклоняется структурной ошибкой (`RejectCode`), не
  падает стектрейсом и не аллоцирует память под фиктивный count.
- **3MF/OPC (zip)**: до извлечения содержимого проверяются path traversal в
  именах частей, суммарный распакованный размер и отношение
  uncompressed/compressed на entry (zip-бомба). Работает и на входящие
  файлы, и на собственный сгенерированный 3MF (`validate_3mf`).
- **Разбор — всегда в изолированном процессе** (`fork` + `RLIMIT_AS` +
  wall-timeout в родителе) — упавший/зависший/сожравший память разбор
  убивает только потомка, воркер продолжает поллинг.

Все отказы — `mesh.errors.RejectionError` (код + сообщение);
`mesh.convert.ConversionError` — alias для обратной совместимости.

## Локальный запуск

```sh
uv sync
uv run ruff check .
uv run pytest
```

CI дополнительно запускает `uv run python scripts/smoke_3mf.py`: генерирует
эталонный куб, пишет 3MF, читает его обратно через `trimesh` и проверяет
структуру Core/Materials/Production. Для внешнего headless-smoke передаются
бинарники `MESH_PRUSA_SLICER_BIN` и `MESH_ORCA_SLICER_BIN` — с MF-1918
провижининг всех трёх (плюс `MESH_CURA_BIN`) зашит в
`.gitverse/workflows/ci.yaml` job `python` (только leg `mesh`), версии —
`docs/infra/slicer.ci.headless.md`.

После смоука и тестов CI запускает `uv run python scripts/slicer_ci_gate.py`
(MF-1920) — реальный импорт ≥50×3 связок принтер×филамент во все три
слайсера (Orca/Prusa/Cura, три разных CLI-пути), падает при регрессе
экспортёра. Корпус связок, метод валидации каждого слайсера и известные
ограничения — докстринги `src/mesh/slicer_ci_corpus.py`/
`slicer_ci_validate.py` и `docs/epics/slicer.profiles.md` § «CI-гейт
реальным импортом».

Внутренний `POST /convert` принимает `multipart/form-data` и возвращает
канонический 3MF потоком; структурированный отчёт передаётся в `X-Mesh-Report`,
а агрегат текущего процесса — в `X-Mesh-Metrics`. В отчёте есть диагностика
частей, `duration_ms`, `memory_peak_bytes` и версии тулчейна. Endpoint доступен
только во внутренней сети; CPU-тяжёлая очередь остаётся у worker.

Локальные зависимости воркера — PostgreSQL и MinIO (эмуляция S3); они
поднимаются через `docker compose`, см. корневой `docs/architecture/readme.md`.
