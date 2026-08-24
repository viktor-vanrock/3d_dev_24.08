# `project-import.v1`: job payload/result для импорта Git/STL/3MF

**Решение MF-1964** (эпик [MF-1963](mention://issue/9a1aaeb1-bb9a-4fb6-a8ec-a04e1d0f0ade)). Шов
`packages/contracts/jobs/project-import.ts` — API (`apps/api/src/models`+`git`, продюсер) ↔
импорт-воркер (консюмер). Владелец продюсера — **Back**. Обработчик очереди в v1 переиспользует
статус-словарь и claim-паттерн уже live для Cults3D (`apps/api/src/imports/{queue,worker}.ts`,
`apps/api/src/import/connector.ts`, владелец **Data**), не изобретает новый. Security/quarantine для
`source.kind: "git"` — отдельный шов [MF-1966](mention://issue/d5e8f298-f357-4446-947c-388dcd18fae6);
этот контракт описывает только API↔воркер payload/result, не исполнение fetch.

Нормативный прозаический канон трёх сценариев импорта —
[`docs/architecture/project.manifest.md`](../architecture/project.manifest.md) §8 (STL batch / 3MF /
Git-snapshot) и [`docs/product/project.as.code.md`](../product/project.as.code.md) («Одна схема, три
точки входа»). Целевая форма резолвленного графа — [project.code.v1.md](project.code.v1.md).

## Версия и статус-словарь

`contract_version` — ровно `project-import.v1`. Job-статусы — `queued | running | done | failed`
(реальный прецедент `import_jobs.status` в БД, не generic-плейсхолдер `pending` из
`packages/contracts/jobs/README.md`). Неизвестная/старая `contract_version` — воркер отклоняет job
(`project_import_contract_version_unsupported`), не понижает молча.

## Payload: три источника

```ts
type ProjectImportSource =
  | { kind: "git"; remote_url: string; ref: string | null }
  | { kind: "stl"; upload_refs: string[] }   // batch — 1 и более файлов, §8.1
  | { kind: "3mf"; upload_ref: string };     // единый контейнер, не раскладывается на файлы, §8.2
```

Сырые байты **никогда не идут в payload очереди** — `upload_ref(s)` непрозрачны (staged S3 key или
аналог), тот же принцип, что `slice-trust.v1` не кладёт raw config в очередь. `stl` — **batch**
(§8.1: «один regular artifact на файл … каждый файл имеет независимый processing status/retry; все
файлы сходятся в один draft/repo»), минимум один элемент. `3mf` остаётся единым контейнером — object/
build-item адресация происходит внутри файла при резолве, не в payload. Для `git` payload несёт
только `remote_url`+`ref` (snapshot конкретного resolved commit SHA, §8.3) — allowlist/лимиты
исполняет воркер по правилам MF-1966, этот контракт их не переописывает.

## Result: per-item статус + единый resolved graph

```ts
interface ProjectImportItemResult {
  upload_ref: string;
  status: "done" | "failed";
  artifact_id: string | null;   // Id в резолвленном графе; null при failed
  diagnostics: ManifestDiagnostic[];
}
```

Для `stl` — один `ProjectImportItemResult` на файл batch (независимый processing/retry, §8.1). Для
`git`/`3mf` — ровно один синтетический item (весь источник — одна единица обработки). Все три
источника сходятся в тот же `ResolvedProjectGraph` (project.code.v1 canon) — читается отдельно через
models/editor `GET` после того, как `resolved_commit_sha` закоммичен во внутренний bare-репо; этот
контракт не дублирует форму резолвленного графа в result.

- `resolved_commit_sha` — commit во **внутреннем** bare-репо проекта; `null` только при `failed`.
- `external_commit_sha` — только для `kind: "git"`: resolved sha внешнего ref на момент fetch
  (provenance, §8.3: «upstream URL/ref/commit сохраняются как provenance»). `null` для `stl`/`3mf` и
  при `failed`.
- `manifest_present: false` — источник не содержал `portal.project.yaml`. API синтезирует минимальный
  single-artifact `ResolvedProjectGraph` с default-конфигурацией и печатной фазой (см.
  `project.manifest.v1.minimal.json` fixture) — «простой проект остаётся простым» (`project.as.code.md`
  «Одиночный STL»). Для `git` без манифеста §8.3 также предлагает read-only projection + миграцию —
  это UI/API-поведение вне этого job-контракта, сам job лишь возвращает `manifest_present: false`.
- `last_known_good_preserved: true` всегда, кроме случая, когда именно ЭТОТ импорт впервые создаёт
  проект (нечего сохранять) — при `failed` прежнее состояние проекта гарантированно не тронуто
  (§8.3, §12: «Invalid external commit не заменяет last-known-good public projection»).

## Идемпотентность и retry

`idempotency_key` — обязателен, дедуп повторной постановки той же job (тот же паттерн, что
`import_bindings.unique(source_platform, external_id)` + `pg_advisory_xact_lock` в существующем
Cults3D-воркере). Повтор с тем же `idempotency_key` возвращает тот же `ProjectImportResult`, не
создаёт второй commit. Транзиентная ошибка — retry с backoff на стороне воркера (тот же
`backoffDelayMs`/`MAX_ATTEMPTS` паттерн, что Cults3D); permanent-ошибка (untrusted source/лимит/
формат) — `status: "failed"` без retry.

## Коды ошибок

Diagnostic-коды переиспользуют минимальный набор `project.manifest.md` §12, где применимо
(`project_import_untrusted_source`, `project_import_limit_exceeded`) плюс специфичные для этого шва,
той же lower_snake_case-конвенции:

| Код | Класс | Когда |
|---|---|---|
| `project_import_untrusted_source` | permanent | MF-1966 policy отклонила git-источник (allowlist/лимиты/hooks) |
| `project_import_limit_exceeded` | permanent | файл/репо превышает лимит (100MB/1GB, git.module.md) |
| `project_import_format_mismatch` | permanent | заявленный формат не совпадает с magic bytes |
| `project_import_unsupported_format` | permanent | формат вне поддерживаемого списка |
| `project_import_manifest_invalid` | не блокирует `done` | манифест найден, но не прошёл project-code.v1 — см. `manifest_present` выше, это НЕ отдельный `failed` |
| `project_import_contract_version_unsupported` | permanent | неизвестная `contract_version` payload |

Формат детектируется **по фактическим байтам застейдженного файла**, не по заявленному расширению
(тот же принцип, что `detectAndValidateFormat` в существующем import-коде) —
`project_import_format_mismatch`, если расхождение.

## Наблюдаемость

Воркер логирует `contract_version`, `source.kind`, outcome (`done|failed`) по job и по item,
diagnostics по коду (агрегированно), `idempotency_key`, correlation/job id. **Нельзя логировать**
`remote_url` с embedded credentials (MF-1966 запрещает credentials в URL на входе), содержимое
файлов, raw manifest text. Метрики: счётчик отказов по коду и по `source.kind`, латентность импорта
по размеру источника, доля `manifest_present: false` (сколько импортов — «просто файл», не
project-as-code).

## Migration path

1. Back реализует воркер-обработчик поверх существующего Cults3D queue/worker-паттерна
   (`apps/api/src/imports`); git-side (внутренний bare-репо, commit, quarantine-интеграция) — новый
   код в `apps/api/src/git`, координируется с MF-1965.
2. `source.kind: "git"` активируется только после приёмки [MF-1966](mention://issue/d5e8f298-f357-4446-947c-388dcd18fae6) —
   API держит `project_import_untrusted_source` как default-deny, пока allowlist/лимиты не в коде.
3. `stl`/`3mf` не зависят от MF-1966 и поставляются независимо, как только Back реализует
   `manifest_present: false` synthesis-путь.
4. Несовместимое изменение формы — новая `project-import.v2`; job в очереди на момент миграции
   обрабатываются по старой версии до дренажа очереди.

## Fixtures

[`jobs/fixtures/project-import.v1.json`](../../packages/contracts/jobs/fixtures/project-import.v1.json) —
четыре сценария: `git_lerobotdepot` (успешный Git-импорт с манифестом), `stl_batch` (batch из одного
файла, синтез минимального манифеста), `multipart_3mf` (3MF без манифеста, warning-диагностика по
item), `failed_quarantine_rejected` (MF-1966 policy отклонила источник, `last_known_good_preserved:
true`, `items: []`). Проверены TS guard'ом `isProjectImportPayload` и структурными assertions на
`external_commit_sha`/`manifest_present`/per-item `artifact_id`/`last_known_good_preserved` — см.
`jobs/project-import.test.ts`.
