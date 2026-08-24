# Контракты межсервисных и межкомандных швов

Эта папка хранит человекочитаемые contract decisions. Исполнимые типы и схемы живут в
`packages/contracts/`; изменение формы на шве должно быть аддитивным или получить новую версию.

| Контракт | Версия | Стороны |
| --- | --- | --- |
| [community.antiabuse.v1.md](community.antiabuse.v1.md) | `community-antiabuse.v1` | Data, Back, Fullstack, Front |
| [audit-log.md](audit-log.md) | `audit.v1` | Data, Back, Docs |
| [community-moderation.md](community-moderation.md) | — | Data, Back, Docs |
| [community-moderation-api.md](community-moderation-api.md) | `v1` | Back, Fullstack, Test, Docs |
| [community-moderation-actions.md](community-moderation-actions.md) | `community-moderation-actions` | Back, Data, Test, Docs |
| [community-moderation-acceptance.md](community-moderation-acceptance.md) | `community-moderation-acceptance` | Back, Front, Test, Docs |
| [community-moderation-review.md](community-moderation-review.md) | — | Data, Back, Test, Docs |
| [relay-command-result.v1.md](relay-command-result.v1.md) | `relay-command-result.v1` | Back, Relay, Front, Test, Docs |
| [printer.operating.v1.md](printer.operating.v1.md) | `printer_operating.v1` | Data, Back, Front, Design/UX, Test |
| [slice-trust.v1.md](slice-trust.v1.md) | `slice-trust.v1` | Devices, Mesh, Data |
| [printers.catalog.v1.md](printers.catalog.v1.md) | `printers.catalog.v1` | Data, Front |
| [project.code.v1.md](project.code.v1.md) | `project-code.v1` | Back, Front |
| [project.import.v1.md](project.import.v1.md) | `project-import.v1` | Back, Data |
| [assistant.run.v1.md](assistant.run.v1.md) | `giga.assistant-run.v1` (ПРЕДВАРИТЕЛЬНО, до MF-1999) | AI, Back |
| [model.index.v1.md](model.index.v1.md) | `model-index.v1` | AI, Data, Back, CTO |

JSON-сценарии, которые обязан использовать backend/QA, лежат в `fixtures/` рядом с решением.

Ключевые fixtures:

- [relay.reconciliation.v1.json](fixtures/relay.reconciliation.v1.json) — восстановление
  sequenced telemetry и durable command после reconnect.
- [printer.operating.v1.json](fixtures/printer.operating.v1.json) — live-доступность,
  режимы соединения и разрешённые команды принтера (MF-1244); версионируемый data-контракт
  support_level/connector_type/connection_mode/availability/freshness и различие
  unknown/unavailable/unsupported — [printer.operating.v1.md](printer.operating.v1.md) (MF-1199).
- [`packages/contracts/http/fixtures/project.manifest.v1.minimal.json`](../../packages/contracts/http/fixtures/project.manifest.v1.minimal.json)
  и `project.manifest.v1.lerobotdepot.json` — минимальный синтезированный манифест и сложный
  многокомпонентный проект (BOM/сцены/instances/connections/все 5 фаз workflow/`x-*`), проверены
  ajv против [`project.manifest.v1.schema.json`](../../packages/contracts/http/project.manifest.v1.schema.json)
  — [project.code.v1.md](project.code.v1.md) (MF-1964).
- [`packages/contracts/jobs/fixtures/project-import.v1.json`](../../packages/contracts/jobs/fixtures/project-import.v1.json) —
  Git/STL/3MF import payload+result, включая quarantine-отказ с сохранённым last-known-good —
  [project.import.v1.md](project.import.v1.md) (MF-1964).
