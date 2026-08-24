# User API Keys Rollback Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подтвердить, что откат миграции `user_api_keys` безопасно и идемпотентно убирает только добавленные контрактом объекты и не раскрывает секреты в диагностике.

**Architecture:** Тест выполняется на изолированной копии схемы в `sandbox-db`: down-часть миграции запускается дважды, затем up-часть восстанавливает контракт. Проверки выполняются через каталог `pg_catalog`, поэтому в вывод не попадают строки `user_api_keys`, значения `key_hash` или открытые ключи.

**Tech Stack:** PostgreSQL 16, dbmate SQL-миграции, `psql`, Bash.

## Global Constraints

- Не запускать миграции на общей `portal_dev`; использовать только `sandbox-db`.
- Не выводить `DATABASE_URL`, содержимое `user_api_keys`, `key_hash`, `secret_enc` или открытый ключ.
- Проверять только `apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql` и диагностическую обёртку `apps/api/src/publicapi/apiKeyRepository.ts`.

---

### Task 1: Проверить обратимость DDL на песочнице

**Files:**
- Modify: `apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql:34-41` (только если проверка найдёт дефект)
- Test: `apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql`

**Interfaces:**
- Consumes: существующая таблица `user_api_keys` и DDL секций `migrate:up`/`migrate:down`.
- Produces: отсутствие индекса `user_api_keys_active_expiry_idx`, constraint `user_api_keys_scopes_check` и четырёх колонок после down; их восстановление после up.

- [ ] **Step 1: Создать изолированную БД без вывода DSN**

Run: `sandbox-db create sbx_mf1395 >/dev/null`

Expected: команда завершается с кодом 0; общая `portal_dev` не изменяется.

- [ ] **Step 2: Загрузить только схему текущего dev в песочницу**

Run: `docker exec portalru-dev-shared-postgres-1 bash -c 'pg_dump -U portal_dev --schema-only -d portal_dev | psql -q -U portal_dev -d sbx_mf1395'`

Expected: команда завершается с кодом 0; данные ключей не копируются.

- [ ] **Step 3: Прогнать down дважды и проверить базовое состояние**

Run: `docker exec -i portalru-dev-shared-postgres-1 psql -v ON_ERROR_STOP=1 -U portal_dev -d sbx_mf1395 < <(sed -n '/^-- migrate:down/,$p' apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql)`

Expected: обе попытки down завершаются с кодом 0; запрос к `pg_attribute`, `pg_constraint` и `pg_class` не находит объектов контракта.

- [ ] **Step 4: Прогнать up и проверить восстановленный контракт**

Run: `docker exec -i portalru-dev-shared-postgres-1 psql -v ON_ERROR_STOP=1 -U portal_dev -d sbx_mf1395 < <(sed -n '/^-- migrate:up/,/^-- migrate:down/p' apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql)`

Expected: команда завершается с кодом 0; `scopes`, `expires_at`, `updated_at`, `revoked_reason`, `user_api_keys_scopes_check` и `user_api_keys_active_expiry_idx` снова существуют.

- [ ] **Step 5: Удалить песочницу**

Run: `sandbox-db drop sbx_mf1395`

Expected: команда завершается с кодом 0; временная БД отсутствует в `sandbox-db list`.

### Task 2: Проверить безопасную диагностику репозитория

**Files:**
- Modify: `apps/api/src/publicapi/apiKeyRepository.ts:39-44` (только если ошибка раскрывает текст драйвера)
- Test: `apps/api/src/publicapi/apiKeyRepository.test.ts:35-42`

**Interfaces:**
- Consumes: `safeQuery<T>(db, query, values)` и ошибку драйвера БД.
- Produces: `Error("не удалось выполнить операцию с API-ключом")` без текста исходной ошибки.

- [ ] **Step 1: Установить lockfile-зависимости**

Run: `pnpm install --frozen-lockfile`

Expected: команда завершается с кодом 0.

- [ ] **Step 2: Выполнить регрессионный тест redaction**

Run: `pnpm --filter @portal/api exec vitest run src/publicapi/apiKeyRepository.test.ts`

Expected: тест `не раскрывает секрет в ошибке запроса` проходит; в отчёте нет его тестового значения.

- [ ] **Step 3: Проверить типы и дубли timestamp миграций**

Run: `pnpm --filter @portal/api run typecheck && pnpm --filter @portal/api run db:check-migrations-dup`

Expected: typecheck завершается с кодом 0; проверка дубликатов сообщает только известное состояние, если оно не относится к файлу `20260712230100_user_api_keys_public_contract.sql`.

- [ ] **Step 4: Создать коммит только при точечном исправлении**

Run: `git add apps/api/db/migrations/20260712230100_user_api_keys_public_contract.sql apps/api/src/publicapi/apiKeyRepository.ts apps/api/src/publicapi/apiKeyRepository.test.ts && git commit -m "fix(api): безопасный rollback user api keys MF-1357"`

Expected: коммит создаётся только если проверка выявила дефект; иначе рабочий код остаётся без изменений.
