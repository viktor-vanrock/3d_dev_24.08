# `project-code.v1`: манифест `portal.project.yaml` и models/editor API

**Решение MF-1964** (эпик [MF-1963](mention://issue/9a1aaeb1-bb9a-4fb6-a8ec-a04e1d0f0ade)). Шов
`packages/contracts/http/models.ts` + `project.manifest.v1.schema.json` принадлежит двум сторонам:
**Back** (`apps/api/src/models`, `apps/api/src/git`) — владелец YAML-парсера/резолвера, git-записи и
CAS; **Front** (`apps/web/src/market`) — консюмер, заменяет локальные типы
`apps/web/src/market/models.types.ts` на этот контракт и реализует редактор. Data не пишет в
`apps/web`, Front этой сессии не правит backend — оба независимо реализуют producer/consumer после
фиксации этого контракта.

**Нормативный прозаический канон — [`docs/architecture/project.manifest.md`](../architecture/project.manifest.md)**
(закоммичен CTO вместе с [`docs/product/project.as.code.md`](../product/project.as.code.md) во время
подготовки этого решения, MF-1963). Этот документ не пересказывает канон — он фиксирует то, что канон
явно оставляет за MF-1964 («исполняемая JSON Schema и TS-контракты поставляются MF-1964»): точную
исполняемую форму, HTTP-ошибки/идемпотентность/наблюдаемость API-поверхности и migration path.
[`project.manifest.v1.schema.json`](../../packages/contracts/http/project.manifest.v1.schema.json) и
[`http/models.ts`](../../packages/contracts/http/models.ts) реализуют канон буквально — см. §Форма
ниже про то, где ранний черновик этого решения (до появления канона) разошёлся и был исправлен.

Источники: [service.map.md](../architecture/service.map.md) §1–3,
[project.manifest.md](../architecture/project.manifest.md) (нормативная форма),
[project.as.code.md](../product/project.as.code.md) (продуктовый канон),
[git.module.md](../architecture/git.module.md) (git-модуль, лимиты, лок),
[project.git.md](../epics/project.git.md) §10.1–10.2 (storage split, legacy роли файлов), эпик
MF-1963.

## Форма: где исполняемый контракт реализует канон буквально

`schema` (не `schema_version`) — литеральная константа `https://schemas.3mf.tech/project/v1`
(`project.manifest.md` §2: «schema major находится в URL»). Составные ключи — **kebab-case**
(`default-configuration`, `catalog-ref`, `active-connections`, `depends-on`, `from-scene`,
`allow-skip`), не snake_case. `artifacts`/`components`/`configurations`/`scenes`/`connections`/
`workflows` — **id-keyed maps** (`Record<Id, T>`), не массивы с полем `id`. `translation`/`rotation`
— **array-кортежи** `[x,y,z]`/`[x,y,z,w]`, не объекты `{x,y,z}`. `Id` — `^[a-z0-9][a-z0-9.-]{0,63}$`
(точка и дефис, БЕЗ подчёркивания). Diagnostic-коды и HTTP error-коды — **lower_snake_case** с
префиксом `project_`, не UPPER_SNAKE_CASE (несмотря на то, что это доминирующая конвенция в
`community.ts`/`trust-policy.ts`/`slice-trust.v1` — здесь она явно переопределена канон-документом,
см. `project.manifest.md` §12).

Это принципиально другая форма, чем в UPPER_SNAKE_CASE/snake_case/array-based черновике, который
существовал до появления `project.manifest.md` в этой же сессии подготовки решения — переход
пойман и исправлен через сквозную проверку `ajv` (draft 2020-12, `strict`) обеих fixture против
итоговой схемы, плюс `tsc --strict` и `vitest` на TS-зеркале (`http/models.test.ts`,
`jobs/project-import.test.ts`) при подготовке этого решения; воспроизводимо:
`pnpm --package=vitest dlx vitest run` внутри `packages/contracts`.

## Namespaced `x-*`: где именно в дереве

`x-*` — поле ВНУТРИ каждой структурированной записи (`Project`, `Artifact`, `Component`,
`Interface`, `Configuration`, `Scene`, `Connection`, `Phase`, `Step`, `Transform`), не отдельная
псевдо-запись внутри id-keyed map-контейнера (`artifacts`/`components`/…). Ключи id-keyed map —
исключительно `Id`; расширение всегда живёт как соседнее поле у конкретной сущности
(`components.follower-arm.x-vendor-note`), не как `components.x-something`. Резолвер обязан сохранить
эти поля verbatim при round-trip (project.manifest.md §7: «Round-trip семантический… обязан
сохранить resolved graph и `x-*`»).

## YAML 1.2 safe subset

Плейн YAML: map/seq/str/int/float/bool/null. **Запрещены**: якоря/алиасы, кастомные теги,
merge-ключи; дубликат ключа — ошибка парсинга (`project_yaml_unsafe`), не last-write-wins.
Числа — конечные (без `NaN`/`Infinity`). Выбор конкретной YAML-библиотеки и её safe-режима — за
Back (contracts не тянет рантайм-зависимость, как и `slicer.ts`/`mesh.ts` не тянут).

## Diagnostic — точная позиция

```ts
interface ManifestDiagnostic {
  code: ManifestDiagnosticCode;   // lower_snake_case, project.manifest.md §12 — 14 минимальных кодов
  severity: "error" | "warning";
  json_path: string;              // "configurations.pla-sg90.bom[2].quantity"
  yaml_line?: number | null;      // 1-based; отсутствует для кросс-полевых ошибок
  yaml_column?: number | null;
  entity_id?: string | null;
  message: string;
  hint?: string | null;
}
```

Полный список `MANIFEST_DIAGNOSTIC_CODES` — в `http/models.ts`, дословно повторяет минимальный
набор §12 канона (`project_schema_unsupported` … `project_secret_detected`). Аддитивные более
специфичные коды с тем же префиксом/casing допустимы без новой версии контракта; удалять или
переименовывать коды из минимального набора — только через major.

## Models/editor API: чтение, запись, CAS

`GET` возвращает `head_sha`, `manifest_digest` (sha256 канонического JSON резолвленного графа,
project.manifest.md §6), `configuration_digest` выбранной конфигурации, `manifest` и `diagnostics`
последнего резолва. `warning`-и не блокируют чтение; при `error` API отдаёт **last-known-good**
resolved graph — Git-write никогда не затирает last-known-good проекцию при ошибке (§7, §12:
«Invalid external commit не заменяет last-known-good public projection»).

Запись — **compare-and-swap** по `base_head_sha` (точное имя поля — §7 канона; продуктовый
`project.as.code.md` использует неформальный термин «base commit» для того же понятия): `PUT`
несёт `base_head_sha` (тот `head_sha`, с которым редактор начал правку) и **полную разрешённую
authoring-модель** (`manifest: ResolvedProjectGraph`) — API сериализует YAML и владеет
форматированием; «typed patch» как альтернативный меньший payload канон допускает («или»), но это
v1.1-объём, не входит в минимальный контракт MF-1964. `base_head_sha !== текущий head` →
`409 project_head_conflict`, ответ несёт актуальный `current_head_sha`, git не трогается.

### Коды ошибок (HTTP envelope, отдельно от diagnostic-кодов выше)

| Код | HTTP | Когда |
|---|---|---|
| `project_manifest_invalid` | 400 | diagnostics содержат хотя бы один `error` |
| `project_head_conflict` | 409 | `base_head_sha` не совпадает с текущим head |
| `project_schema_unsupported` | 409 | `schema` неизвестна/отсутствует |
| `project_not_found` | 404 | нет доступа ИЛИ проект не существует — неразличимо (тот же принцип, что `slice-trust.v1` §API) |
| `project_forbidden` | 403 | доступ есть к факту существования, но не к записи |

## Storage class

| Storage class | Что | Регенерируется |
|---|---|---|
| `git` | `portal.project.yaml`, README, user source files (project.manifest.md §10) | нет |
| `s3-derived` | GLB/WebP/canonical outputs | да, из git |
| `s3-description` | `description_image` (единственное неregenerируемое исключение вне git, MF-514) | нет |

## Публичные bounded git-reads: tree / readme / history

Гостевой доступ к публичному проекту сейчас закрыт багом ([MF-1965](mention://issue/3d307df0-4bc2-4c6e-9d1f-59995a957b4c)
находка: «tree/readme/history закрыты гостю, хотя landing публичный») — этот контракт фиксирует
целевую ПУБЛИЧНУЮ форму (project.manifest.md §9: «public read: … bounded tree/readme/history»):

- `PublicRepoTreeResult`/`PublicRepoHistoryResult` — bounded (`REPO_READ_PAGE_LIMIT = 100`),
  непрозрачный `next_cursor`, инвариант `has_more === (next_cursor !== null)` (тот же паттерн, что
  `printers.catalog.v1`).
- `PublicRepoHistoryCommit` **не содержит `author_email`** (в отличие от внутреннего
  `RepoHistoryCommit` в текущем `apps/web/src/market/models.types.ts`).
- Приватный проект отдаёт `403 project_forbidden` для гостя на все три ручки; публичный — без сессии.

Полная API-поверхность (public read landing/configurations/resolved manifest/scenes/requirements;
authoring create-draft/upload/import/editor-projection/save/validate/publish; build
session/step/preview/complete; social Make/review/post — project.manifest.md §9) шире, чем
манифест+CAS+bounded-reads, зафиксированные здесь: draft/session/social поверхность — отдельные
будущие контракты (вне MF-1964 объёма), их продюсеры и владельцы определит следующая стадия эпика.

## Наблюдаемость

Back логирует `schema`, `diagnostics[].code` (агрегированно по коду, не raw manifest text), outcome
записи (`accepted|conflict|invalid`), correlation/request id. **Нельзя логировать** raw manifest
целиком, `author_email` в публичном пути, содержимое `x-*` расширений сторонних инструментов.
Метрики: счётчик `project_head_conflict` по проекту, счётчик diagnostics по коду, латентность
резолва по размеру манифеста.

## Migration path

1. Back добавляет YAML-парсер+резолвер (пайплайн §6 канона: quarantine → parse → schema → normalize
   → resolve refs → validate DAG/scenes/compatibility → canonical JSON → digests → last-known-good →
   derived jobs) и роуты `GET/PUT /models/:id/manifest`, `GET /models/:id/tree|readme|history` —
   параллельно с [MF-1965](mention://issue/3d307df0-4bc2-4c6e-9d1f-59995a957b4c) и
   [MF-1966](mention://issue/d5e8f298-f357-4446-947c-388dcd18fae6), независимо по коду.
2. Front заменяет типы `apps/web/src/market/models.types.ts` на импорт из
   `@portal/contracts/http/models`.
3. Простой одиночный STL/3MF без авторского манифеста продолжает работать без изменений в UI —
   `project-import.v1` синтезирует минимальный `ResolvedProjectGraph` с default-конфигурацией и
   печатной фазой (см. [project.import.v1.md](project.import.v1.md)).
4. `configuration_digest`/pinned build session (§6: `model_id + commit_sha + configuration_id +
   configuration_digest`) — используется build-session контрактом следующей стадии; этот контракт
   только производит и отдаёт `configuration_digest`, не описывает его потребление.

## Fixtures

[`http/fixtures/project.manifest.v1.minimal.json`](../../packages/contracts/http/fixtures/project.manifest.v1.minimal.json) —
синтезированный минимальный манифест (project.manifest.md §13 п.1: «Minimal STL fixture создаёт
README + manifest + default config»).
[`http/fixtures/project.manifest.v1.lerobotdepot.json`](../../packages/contracts/http/fixtures/project.manifest.v1.lerobotdepot.json) —
расширение примера §4 канона до §13 п.3 («минимум две конфигурации и пять типов фаз»): две
конфигурации (`so101-pair`, `so101-single`), BOM, сцены/соединения, все пять фаз включая `solder`.
Оба fixture проверены `ajv` (draft 2020-12, `strict`) против `project.manifest.v1.schema.json` и TS
guard'ом `isResolvedProjectGraph` — согласованно, включая отрицательные кейсы (неизвестное поле,
недопустимый `kind`, connection с одним endpoint, id в неверном регистре, деформированный
кватернион, отсутствующий `default-configuration`).
