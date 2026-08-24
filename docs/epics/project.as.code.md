# EPIC: Project-as-code — манифест, сборочные сцены и Git↔web round-trip

Issue: [MF-1963](mention://issue/9a1aaeb1-bb9a-4fb6-a8ec-a04e1d0f0ade).
Проект доски: «Проекты и 3D-контент». Приоритет: urgent. Дедлайн
контрактного фундамента: 30.09.2026.

Канон продукта:
[../product/project.as.code.md](../product/project.as.code.md).
Архитектурная форма:
[../architecture/project.manifest.md](../architecture/project.manifest.md).
Фундамент Git: [project.git.md](project.git.md), MF-514.

## 1. Проблема

MF-514 сделал Git источником файлов и README, но структура папок не может
однозначно выразить:

- конфигурации результата;
- BOM и требования;
- адресацию деталей внутри 3MF;
- точки соединения и крепёж;
- 3D-сцены до/после действия;
- зависимости фаз печати, сборки, прошивки, пайки и проверки.

Если эти данные появятся только в таблицах/API, Git станет декоративным
архивом, web — второй непереносимой моделью, а агент не сможет оформить
полный проект обычным diff.

## 2. Решение

В корне проекта появляется `portal.project.yaml`:

- декларативная JSON-Schema-backed модель;
- Git хранит manifest, README и user source files;
- web визуально редактирует тот же manifest;
- STL/3MF импортер создаёт минимальный manifest автоматически;
- Git/GitVerse importer валидирует существующий или предлагает миграцию;
- Postgres хранит индекс, last-known-good projection и операционное
  состояние;
- build session pinned к commit/config digest.

Никакой новой продуктовой таблицы `projects`: `models`/`model_files`/
`model_meshes` развиваются как существующий агрегат.

## 3. Не делаем

- forge или публичный Git-протокол;
- arbitrary code execution;
- автоматические команды принтеру/плате без capability check и
  подтверждения;
- обязательный GitVerse;
- live collaborative scene editing;
- physics/collision/AR;
- публикацию private build session в Git;
- полный UI ЧПУ/электроники в v1.

## 4. Барьеры поставки

### Стадия 1 — контракт и безопасный фундамент

Параллельно:

- **MF-1964 / Contract Architect:** schema/types/fixtures для
  `project-code.v1` и `project-import.v1`;
- **MF-1965 / Back:** консистентный models/git aggregate, CAS, receipts,
  полный fork, bounded public reads, git hardening;
- **MF-1966 / Ops:** quarantine/security модель внешнего Git-импорта.

Стадия закрыта, когда шов апрувнут CTO, существующий Git-агрегат не имеет
известных dual-write окон, а threat model имеет исполнимые лимиты.
Security-часть опубликована в
[../architecture/git.import.security.md](../architecture/git.import.security.md);
реализация импорта остаётся за Back после утверждения контракта.

### Стадия 2 — parser/resolver и импорт

После стадии 1:

1. **Back:** safe parser/resolver, diagnostics, last-known-good projection,
   public/editor API, revision digests.
2. **Data:** producer существующего import-контура публикует только
   `project-import.v1`; прямые импорты/записи в `models/*` запрещены.
3. **Back + Ops review:** quarantine consumer GitVerse snapshot →
   internal bare repo → `models/model_files` → Mesh job.
4. **Mesh:** STL batch и 3MF analysis возвращают stable object/build-item
   refs, units, transforms и content digests.

### Стадия 3 — web authoring

Владелец визуала — внешний Front/Codex под оператором; агенты Back/Data
дают контракт и fixtures, но не правят `apps/web`.

1. Единый import wizard: Git / пачка STL / 3MF.
2. ProjectDraft переживает reload и имеет независимый retry артефактов.
3. Visual assembly editor:
   tree ↔ canvas ↔ inspector, selection, translate/rotate, numeric mobile
   fallback, stable interfaces/connections, undo/redo.
4. Save по head/CAS, conflict UI, diagnostics, review tree, publish.
5. Build-guide ссылается на stable instance/connection ids, а не filename.

Three.js editor не нормализует физический scale/center как текущий
просмотровый `modelscene.ts`; он работает в исходных координатах и mm.

### Стадия 4 — conformance и пилот

- LeRobotDepot fixture: минимум две конфигурации, BOM, сцены и фазы
  `print/assembly/flash/solder/check`;
- minimal STL и multipart 3MF fixtures;
- semantic round-trip Git → web → Git;
- hostile repository/security suite;
- build session pin/migration preview;
- публичный API parity;
- live evidence на dev.3mf.tech.

### Стадия 5 — connected GitVerse

После подтверждения API/scopes:

- Portal-hosted export/mirror;
- GitVerse-connected snapshot/webhook;
- branch/PR write path;
- один canonical remote, no dual-master;
- signed webhook, replay/idempotency и secret redaction.

Эта стадия не блокирует локальный project-as-code и простые импорты.

## 5. API-швы

Точные типы утверждает MF-1964. Нужны:

- public landing/configurations/scenes/resolved manifest;
- bounded tree/readme/history;
- author draft/editor projection;
- multi-artifact upload;
- repository import job;
- validate/save/publish с base head;
- pinned build session и step commands;
- Make/review/post с commit/config reference.

`apps/web` обращается только к HTTP-контракту. Data producer и Back consumer
общаются только через jobs-контракт. Импорты из чужого `src` запрещены.

## 6. Критерии приёмки эпика

1. Один STL создаёт валидный Git-проект без знания YAML пользователем.
2. 3MF сохраняет stable object/build-item refs, units и transforms.
3. Complex Git fixture воспроизводит BOM, configs, scenes и workflow.
4. Agent может создать/изменить проект обычным diff и локально
   провалидировать его.
5. Web правит тот же manifest, сохраняет `x-*` и не теряет concurrent edit.
6. Invalid commit оставляет live last-known-good landing.
7. Build session pinned и мигрируется только явно.
8. Portal-hosted ↔ GitVerse export/import сохраняет digests/blob hashes.
9. Public API имеет parity с web.
10. Security suite блокирует все угрозы из MF-1966.
11. Legacy-проект остаётся доступен и мигрируется обратимым commit.
12. Simple project UI остаётся спокойным и не показывает Git/scene jargon.

Эпик закрывает CTO только после живого evidence по contract, import, editor
и LeRobotDepot build flow.
