# План реализации сериализации capability каталожного принтера

> **Для агентных исполнителей:** выполнить план по задачам; шаги используют чекбоксы (`- [ ]`) для отслеживания.

**Цель:** Сделать detail-ответ каталожного принтера стабильным, безопасно нормализованным и совместимым со старыми строками `printers`.

**Архитектура:** `apps/api/src/printers/serialize.ts` станет единственной границей нормализации: известные поля schema v1 формируются в фиксированном порядке, JSONB дополняет legacy-колонки только валидными значениями. Невалидные или неизвестные capability в сохранённом JSON не попадают в ответ; публичный query продолжает принимать только словарь `printers.catalog.v1`.

**Стек:** TypeScript, Fastify, Vitest, PostgreSQL row DTO.

## Общие ограничения

- Изменение detail DTO только аддитивное; существующие client-поля не переименовываются и не удаляются.
- Неизвестное значение сериализуется как `null` или `[]`, а не угадывается.
- Remote-публикация допускается только в `origin/dev` из detached HEAD.
- Никаких секретов, IP, credentials или device-side runtime в portal API.

---

### Задача 1: Зафиксировать golden-контракт нормализованного detail DTO

**Файлы:**
- Modify: `apps/api/src/printers/serialize.test.ts`

**Интерфейсы:**
- Использует: `serializePrinter(row: PrinterRow, now?: Date)`.
- Результат: golden-проверка порядка, `null`/`[]`, legacy fallback и фильтрация unknown capability.

- [ ] **Step 1: Добавить failing unit test**

```ts
expect(serializePrinter(row)).toEqual(expected);
expect(JSON.stringify(serializePrinter(row))).toBe(JSON.stringify(serializePrinter(permutedRow)));
```

- [ ] **Step 2: Запустить тест и подтвердить красный результат**

Run: `pnpm --filter @portal/api exec vitest run src/printers/serialize.test.ts`
Expected: FAIL, потому что raw `specs` сейчас сохраняет неизвестный capability и порядок ключей.

- [ ] **Step 3: Закоммитить только после зелёной реализации из Task 2**

```bash
git add apps/api/src/printers/serialize.test.ts apps/api/src/printers/serialize.ts docs/contracts/printers.catalog.serialization.v1.md
git commit -m "fix(MF-1231): stabilize printer capability serialization"
```

### Задача 2: Нормализовать DTO и описать rollback

**Файлы:**
- Modify: `apps/api/src/printers/serialize.ts`
- Create: `docs/contracts/printers.catalog.serialization.v1.md`

**Интерфейсы:**
- Использует: legacy `PrinterRow` с column facets и potentially malformed `specs`/`media` JSONB.
- Результат: `serializePrinter` с известными schema-v1 секциями, конечными числами, нормализованными массивами и стабильным key order.

- [ ] **Step 1: Реализовать чистые normalizer helpers**

```ts
function numberOrNull(value: unknown): number | null;
function recordOrEmpty(value: unknown): Record<string, unknown>;
function strings(value: unknown): string[];
```

- [ ] **Step 2: Собрать fixed-shape sections**

```ts
build_volume: { x, y, z, shape, diameter }
hotend: { max_temp_c, max_flow_mm3s, nozzle_default_mm, nozzle_swappable, material, hardened }
```

- [ ] **Step 3: Описать source-of-truth, unknown capability и rollback**

```md
JSONB is preferred only for a known valid field; a missing or malformed legacy value falls back to the relational facet column.
```

- [ ] **Step 4: Запустить unit и contract tests**

Run: `pnpm --filter @portal/api exec vitest run src/printers/serialize.test.ts src/catalog/query.test.ts`
Expected: PASS.

### Задача 3: Проверить API-границу и доставить в dev

**Файлы:**
- Test: `apps/api/src/catalog/printers.test.ts`

**Интерфейсы:**
- Использует: `GET /printers` и `GET /printers/:slug`.
- Результат: отсутствие unknown capability в публичной выдаче и обратно-совместимый detail DTO.

- [ ] **Step 1: Запустить API tests**

Run: `pnpm --filter @portal/api exec vitest run src/catalog/printers.test.ts`
Expected: PASS или документированный инфраструктурный blocker базы данных.

- [ ] **Step 2: Проверить типы и diff**

Run: `pnpm --filter @portal/api typecheck && git diff --check`
Expected: PASS.

- [ ] **Step 3: Rebase и publish**

```bash
git fetch origin dev
git rebase origin/dev
git push origin HEAD:refs/heads/dev
```

Expected: SHA доступен в `origin/dev`; rollback — revert одного commit, так как миграция не требуется.

## Самопроверка

- Spec coverage: обязательные/необязательные поля, null/empty, legacy fallback, deterministic JSON, unknown capability, tests, docs и rollback покрыты Tasks 1–3.
- Placeholder scan: отсутствуют TBD/TODO и неуточнённые тестовые шаги.
- Type consistency: все тесты используют экспортируемый `serializePrinter`, а API остаётся consumer существующего DTO.
