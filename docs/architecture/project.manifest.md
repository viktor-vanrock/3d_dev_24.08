# Project manifest v1: архитектурный контракт

Статус: **канон направления**, исполняемая JSON Schema и TS-контракты
поставляются MF-1964 в `packages/contracts`.

Связи: [../product/project.as.code.md](../product/project.as.code.md),
[../product/projects.md](../product/projects.md),
[../epics/project.git.md](../epics/project.git.md),
[../epics/project.as.code.md](../epics/project.as.code.md),
[git.import.security.md](git.import.security.md),
[service.map.md](service.map.md).

## 1. Граница решения

`portal.project.yaml` — декларативный источник публичной структуры проекта
в корне Git-репозитория. Он дополняет, но не заменяет:

- `README.md` — общее человекочитаемое описание репозитория;
- `make/README.md` — необязательное Portal-first описание результата и
  процесса, с необязательными исходными медиа в `make/media/`;
- `models` / `model_files` — индекс и операционный кэш;
- `model_meshes` — состояние геометрического конвейера;
- build-session таблицы — приватное состояние пользователя;
- S3 — производные превью и description images.

Нельзя вводить параллельную верхнеуровневую `projects`-сущность. Resolver
строит проекцию существующего агрегата `models` из commit репозитория.

Порядок выбора prose для landing:

1. `make/README.md`, если файл существует;
2. корневой `README.md`;
3. синтезированное короткое описание из manifest/импортированного файла.

`make/README.md` никогда не переопределяет IDs, BOM, requirements,
connections, workflow или пути артефактов из manifest. Его Markdown-блоки
могут ссылаться на эти stable IDs через типизированные Portal-вставки, но
сами остаются представлением. Поэтому Git↔web round-trip машинной модели
не зависит от наличия папки `make/`.

## 2. Формат и версия

Корневой файл:

```yaml
schema: https://schemas.3mf.tech/project/v1
```

Правила:

- YAML 1.2 safe subset;
- duplicate keys, aliases, anchors и custom tags запрещены;
- числа конечные, без `NaN`/`Infinity`;
- публичная JSON Schema — нормативна;
- parser поддерживает current и previous major;
- schema major находится в URL;
- миграция major — явная команда и отдельный commit;
- чтение не форматирует и не мигрирует файл молча;
- `x-*` поля разрешены и сохраняются по всему дереву;
- неизвестные ненеймспейсные поля — ошибка.

Точная ревизия проекта — Git commit SHA. Человеческая release-версия/tag
опциональна. Resolved configuration получает отдельный digest.

## 3. Системы координат и идентичность

Канон:

- длина хранится в миллиметрах;
- система координат — right-handed, Z-up;
- положение — `[x, y, z]`;
- вращение — normalized quaternion `[x, y, z, w]`;
- scale по умолчанию `[1, 1, 1]`;
- visual editor может показывать градусы, но сериализует quaternion;
- импорт сохраняет исходные units и явно записывает conversion provenance.

Stable id:

- уникален в своём namespace;
- не зависит от имени файла или позиции в массиве;
- не переиспользуется с новым смыслом;
- допускает `[a-z0-9][a-z0-9.-]{0,63}`;
- ссылки на отсутствующий id — ошибка resolver.

## 4. Минимальная структура

```yaml
schema: https://schemas.3mf.tech/project/v1

project:
  uid: lerobotdepot
  title: LeRobotDepot
  default-configuration: so101-pair
  units:
    length: mm
    coordinates: right-handed-z-up
  license:
    spdx: Apache-2.0
    file: docs/LICENSE.md

artifacts:
  follower-print:
    path: print/SO101/follower.3mf
    kind: print-model

components:
  follower-arm:
    kind: manufactured
    artifact: follower-print
    interfaces:
      base-mount:
        kind: plane
        transform:
          translation: [0, 0, 0]
          rotation: [0, 0, 0, 1]

  motor-board:
    kind: purchased
    catalog-ref: portal:board:feetech-sts3215
    interfaces:
      bracket:
        kind: holes
        transform:
          translation: [12, 0, 8]
          rotation: [0, 0, 0, 1]

configurations:
  so101-pair:
    title: Пара SO-101
    artifacts: [follower-print]
    components: [follower-arm, motor-board]
    workflow: pair-build
    requirements:
      machines: [fdm-220]
      skills: [basic-wiring]

scenes:
  exploded:
    instances:
      arm-1:
        component: follower-arm
        transform:
          translation: [0, 0, 0]
          rotation: [0, 0, 0, 1]
      board-1:
        component: motor-board
        transform:
          translation: [0, 80, 20]
          rotation: [0, 0, 0, 1]

  assembled:
    instances:
      arm-1:
        component: follower-arm
        transform:
          translation: [0, 0, 0]
          rotation: [0, 0, 0, 1]
      board-1:
        component: motor-board
        transform:
          translation: [12, 0, 8]
          rotation: [0, 0, 0, 1]
    active-connections: [board-to-arm]

connections:
  board-to-arm:
    kind: fastener
    endpoints:
      - instance: arm-1
        interface: base-mount
      - instance: board-1
        interface: bracket
    parameters:
      fastener: M3x10
      quantity: 2
      tool: phillips-1

workflows:
  pair-build:
    phases:
      print:
        type: print
        steps: [print-follower]
      assembly:
        type: assembly
        depends-on: [print]
        steps: [mount-board]
      flash:
        type: flash
        depends-on: [assembly]
        steps: [install-lerobot]
      check:
        type: check
        depends-on: [flash]
        steps: [calibrate]
    steps:
      mount-board:
        title: Установите плату
        instruction: Закрепите плату двумя винтами M3×10.
        transition:
          from-scene: exploded
          to-scene: assembled
          add-connections: [board-to-arm]
        evidence:
          accepted: [confirmation, photo]
```

Пример задаёт семантику, но не заменяет JSON Schema MF-1964.

## 5. Сущности

### 5.1 Project

Обязательны `uid`, `title`, `default-configuration`, `units`. Допустимы
license, authors, upstream/provenance, release, safety notices и локализации.
Markdown-описание не дублируется: оно остаётся в `README.md`.

### 5.2 Artifact

Artifact адресует:

- regular file по относительному path;
- object/build-item внутри 3MF;
- внешний immutable artifact только с URL allowlist + SHA-256;
- generated output как recipe reference, но не как байты в manifest.

Минимум: `path`, `kind`, опционально `selector`, `sha256`, `media-type`,
`role`, `provenance`.

Path всегда относителен корню, normalised POSIX, не содержит `..`,
backslash, control characters, absolute prefix или `.git`.

### 5.3 Component и instance

Component описывает повторно используемый тип детали:

- `manufactured`;
- `purchased`;
- `software`;
- `consumable`;
- `tool` — только если инструмент является частью результата; обычные
  инструменты лучше лежат в requirements.

Instance — конкретное появление component в scene/configuration. Один
компонент может иметь N instances.

### 5.4 Interface

Interface — стабильная локальная система координат на component:

- `point`;
- `axis`;
- `plane`;
- `holes`;
- `connector`;
- `electrical`;
- `software`.

Mesh vertex/face index не является стабильным интерфейсом. Допустима
визуальная подсказка по object id и local coordinates, но канон — id +
transform в системе component.

### 5.5 Connection

V1 kinds:

- `fixed`;
- `fastener`;
- `press-fit`;
- `snap`;
- `adhesive`;
- `hinge`;
- `slider`;
- `alignment`;
- `wire`;
- `connector`;
- `solder`;
- `software`.

Connection содержит два или больше endpoints, параметры, нужный hardware,
tool, допуски и safety note. Нельзя ссылаться на filename или индекс массива
вместо stable instance/interface id.

### 5.6 Scene и transition

Scene — полный снимок значимых instances/transforms и активных connections.
Transition — декларативная дельта шага:

- `from-scene` / `to-scene`;
- add/remove connection;
- add/remove/move instance;
- camera pose;
- callout/annotation;
- optional animation keyframes.

Physics и collision solver не обязательны v1. Validator проверяет ссылки,
finite transforms, допустимые циклы и достижимость сцен.

### 5.7 Configuration, requirements и BOM

Configuration выбирает:

- итоговый набор components/artifacts;
- workflow;
- BOM и количества;
- оборудование, материалы, инструменты и навыки;
- compatibility claims и safety notices.

Compatibility — claim с `subject`, `value`, `status`, `provenance` и
confidence. `unknown` — валидное видимое состояние.

Покупной компонент должен ссылаться на catalog id или иметь достаточное
человеческое описание; manifest не хранит цену как вечную истину.

### 5.8 Workflow

Workflow — DAG фаз и шагов. Канонические типы фаз:
`print`, `assembly`, `flash`, `solder`, `check`.

Шаг может содержать:

- Markdown-инструкцию или ссылку на `docs/`;
- inputs/outputs;
- requirements и warnings;
- transition сцены;
- typed action;
- evidence policy;
- allow-skip и причину;
- зависимости.

Typed action не является shell-командой. Например, `open-artifact`,
`prepare-print`, `send-to-printer`, `flash-device` — лишь типизированное
намерение, которое API отдельно авторизует, валидирует capability и просит
явное подтверждение.

## 6. Resolver и digests

Pipeline:

1. загрузить commit в read-only/quarantine;
2. parse safe YAML;
3. проверить JSON Schema;
4. нормализовать units/ids/paths;
5. разрешить ссылки и selected configuration;
6. проверить DAG, scenes и compatibility;
7. построить canonical JSON;
8. вычислить `manifest_digest` и `configuration_digest`;
9. записать last-known-good проекцию;
10. поставить derived jobs по content digest.

Canonical JSON сортирует object keys и stable-id collections; исходный
порядок, важный для UX, задаётся отдельным `position`/`order`, а не
неустойчивым порядком YAML mapping.

Ключ проекции:

```text
repository_id + commit_sha + manifest_digest
```

Build session фиксирует:

```text
model_id + commit_sha + configuration_id + configuration_digest
```

Новый commit не меняет session молча. Миграция показывает diff
добавленных/удалённых/изменённых шагов и требует подтверждения.

## 7. Round-trip и конкуренция

Web читает editor projection вместе с `head_sha`. Сохранение отправляет
typed patch или полную разрешённую authoring-модель и `base_head_sha`.

API:

1. проверяет права и idempotency key;
2. сравнивает expected/current head;
3. применяет правки во временном worktree;
4. валидирует весь проект;
5. создаёт один commit;
6. обновляет DB projection через durable receipt/reconciliation;
7. возвращает новый head и diagnostics.

Несовпадение head → `409 project_head_conflict`. Автоматический merge
допустим только для заведомо независимых полей; первая версия всегда
показывает diff и просит пользователя повторить сохранение.

Round-trip семантический, не побайтовый. Formatter не обязан сохранить
комментарии/пробелы, но обязан сохранить resolved graph и `x-*`. До
подтверждения этой гарантии web не должен переписывать чужой manifest
целиком.

## 8. Импорт

### 8.1 STL batch

- один regular artifact на файл;
- stable id выводится из безопасного имени + content digest, с
  детерминированным collision suffix;
- создаются components и default configuration;
- units спрашиваются явно, если формат их не содержит;
- каждый файл имеет независимый processing status/retry;
- все файлы сходятся в один draft/repo.

### 8.2 3MF

- сохраняются declared units;
- адресация использует object id и build-item id;
- transforms build items сохраняются;
- материалы и plates импортируются как claims/provenance;
- повторный import того же blob сохраняет stable address;
- malformed archive/manifest/relationships отклоняется до публикации.

### 8.3 Git/GitVerse

Первая версия — snapshot конкретного resolved commit SHA:

- allowlist provider;
- fetch в quarantine;
- manifest есть → validate;
- manifest нет → synthesize read-only projection и предложить миграцию;
- upstream URL/ref/commit сохраняются как provenance;
- после валидации проект попадает во внутренний bare repo;
- invalid snapshot не меняет last-known-good landing.

Connected mode позже имеет один canonical remote. Portal-hosted export и
GitVerse-connected PR-write — разные режимы; dual-master запрещён.

## 9. Проекции API

Точные URL/типы утверждает `packages/contracts`; минимальная поверхность:

- public read: landing, configurations, resolved manifest, scenes,
  requirements, bounded tree/readme/history;
- authoring: create draft, upload N meshes/artifacts, import repository,
  read editor projection, save manifest/assembly with CAS, validate, publish;
- build: create pinned session, apply step action, migrate preview,
  complete;
- social: publish Make/review/post с commit/configuration reference.

Web не импортирует `apps/api/src`. API, Data и worker не импортируют
внутренности друг друга; job payload живёт в `packages/contracts/jobs`.

## 10. Хранение

| Класс | Где |
|---|---|
| `portal.project.yaml`, README, user source files | Git |
| `description_image` | S3 |
| GLB/WebP/generated canonical outputs | S3 |
| `models`/`model_files`/`model_meshes` projection | Postgres |
| Import queue/result | существующий jobs/import контур |
| Build session/evidence drafts | Postgres/private object storage |

`description_image` не коммитится в Git: это зафиксировано MF-514. Новая
роль `project_doc` мапится в `docs/`.

## 11. Безопасность

Manifest и repository всегда недоверенные:

- size/depth/node/string limits;
- no aliases/tags/duplicate keys;
- no traversal/absolute/control/casefold collisions;
- symlink, gitlink, submodule, hooks и LFS pointer запрещены v1;
- no shell/eval/template execution;
- external URL allowlist, DNS/IP/redirect SSRF protection;
- MIME + magic-byte validation;
- archive/decompression limits;
- secret scanning до публикации/sync;
- webhook signature, replay protection, idempotency;
- Git author metadata не доказывает Portal identity;
- Portal attestation связывает commit с аккаунтом;
- токены интеграции не попадают в repo;
- private session/evidence не сериализуются в public manifest.

Импорт исполняется в quarantine с timeout, output cap, disk/inode quota,
no-exec и cleanup/recovery. Исполнимая модель и границы ответственности
зафиксированы в [git.import.security.md](git.import.security.md) / MF-1966.

## 12. Ошибки

Каждая diagnostic содержит:

```text
code, severity, json_path, yaml_line?, yaml_column?, entity_id?, message,
hint?
```

Минимальные коды:

- `project_schema_unsupported`;
- `project_yaml_unsafe`;
- `project_duplicate_id`;
- `project_reference_missing`;
- `project_path_unsafe`;
- `project_artifact_missing`;
- `project_transform_invalid`;
- `project_connection_invalid`;
- `project_workflow_cycle`;
- `project_scene_unreachable`;
- `project_head_conflict`;
- `project_import_untrusted_source`;
- `project_import_limit_exceeded`;
- `project_secret_detected`.

Errors блокируют publish. Warnings видимы и требуют явного подтверждения.
Invalid external commit не заменяет last-known-good public projection.

## 13. Критерии конформности v1

1. Minimal STL fixture создаёт README + manifest + default config.
2. Multipart 3MF сохраняет units, object/build-item ids и transforms.
3. LeRobotDepot fixture имеет минимум две configurations и пять типов фаз.
4. Parser детерминированно строит одинаковые digests.
5. Missing refs, DAG cycle и invalid interface дают точный diagnostic.
6. Web round-trip сохраняет semantics и `x-*`.
7. Stale `base_head_sha` не теряет чужую правку.
8. Invalid commit не меняет landing.
9. Build session остаётся pinned после нового commit.
10. Export/import воспроизводит manifest/config digests и blob hashes.
11. Legacy project работает без manifest; миграция — отдельный commit.
12. Security suite покрывает YAML bomb, traversal, symlink/gitlink, archive
    bomb, SSRF, secret и executable action.
