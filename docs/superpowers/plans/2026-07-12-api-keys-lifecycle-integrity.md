# API keys lifecycle integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Гарантировать уникальность публичного идентификатора API-ключа и исключить отозванные либо истёкшие ключи из активной авторизации без изменения HTTP-ответов.

**Architecture:** Аддитивная dbmate-миграция вводит `expires_at`, ограничения хронологии и индексы для активного пути. Проверка ключа и подсчёт активных ключей используют один SQL-предикат `revoked_at is null and (expires_at is null or expires_at > now())`; nullable срок сохраняет существующее бессрочное поведение. Интеграционные тесты работают через настоящий PostgreSQL и проверяют ограничения и план запроса.

**Tech Stack:** PostgreSQL, dbmate, TypeScript, pg, Vitest.

## Global Constraints

- Не менять HTTP-контракт `/me/api-keys/*` и `/v0/*`.
- Секрет ключа по-прежнему хранится только как SHA-256-хэш.
- Миграция должна иметь `migrate:up` и точный `migrate:down`; `db/schema.sql` синхронизируется через dbmate.
- Публичный API считает активным только неотозванный и неистёкший ключ.

---

### Task 1: Ограничения и индексы `api_keys`

**Files:**
- Create: `apps/api/db/migrations/20260712230000_api_keys_lifecycle_integrity.sql`
- Modify: `apps/api/db/schema.sql`

**Interfaces:**
- Consumes: существующая таблица `api_keys(id, owner_id, key_prefix, key_hash, revoked_at, created_at)`.
- Produces: `api_keys.expires_at timestamptz`, `api_keys_key_prefix_key`, `api_keys_active_lookup_idx`, `api_keys_owner_active_idx`.

- [ ] **Step 1: Написать тест ограничений**

В `apps/api/src/publicapi/apiKey.lifecycle.test.ts` добавить вставки с одинаковым `key_prefix`, с
`expires_at <= created_at` и с `revoked_at < created_at`; каждая должна отклоняться PostgreSQL.

- [ ] **Step 2: Запустить тест и подтвердить исходный провал**

Run: `DATABASE_URL=<изолированная БД> pnpm --filter @portal/api exec vitest run src/publicapi/apiKey.lifecycle.test.ts`
Expected: FAIL, потому что до миграции нет `expires_at` и уникальности `key_prefix`.

- [ ] **Step 3: Добавить минимальную миграцию**

```sql
alter table api_keys add column if not exists expires_at timestamptz;
alter table api_keys add constraint api_keys_expires_after_created_check
  check (expires_at is null or expires_at > created_at);
alter table api_keys add constraint api_keys_revoked_after_created_check
  check (revoked_at is null or revoked_at >= created_at);
alter table api_keys add constraint api_keys_key_prefix_key unique (key_prefix);
create index if not exists api_keys_active_lookup_idx
  on api_keys (key_hash, expires_at) where revoked_at is null;
create index if not exists api_keys_owner_active_idx
  on api_keys (owner_id, expires_at, created_at desc) where revoked_at is null;
```

- [ ] **Step 4: Синхронизировать снимок и повторить тест**

Run: `pnpm --filter @portal/api run db:migrate && DATABASE_URL=<изолированная БД> pnpm --filter @portal/api exec vitest run src/publicapi/apiKey.lifecycle.test.ts`
Expected: PASS.

### Task 2: Единый предикат активности в коде

**Files:**
- Modify: `apps/api/src/publicapi/apiKey.ts`
- Modify: `apps/api/src/publicapi/keys.route.ts`
- Test: `apps/api/src/publicapi/apiKey.lifecycle.test.ts`

**Interfaces:**
- Consumes: `api_keys.expires_at` из Task 1.
- Produces: `verifyApiKey(rawKey): Promise<VerifiedApiKey | null>` возвращает `null` для отозванного и истёкшего ключа; лимит создания считает только активные ключи.

- [ ] **Step 1: Добавить поведенческие тесты**

Создать ключ через `createApiKey`, выставить по очереди `revoked_at = now()` и
`expires_at = now() - interval '1 second'`, затем проверить `await verifyApiKey(key) === null`.

- [ ] **Step 2: Запустить тест и подтвердить исходный провал**

Run: `DATABASE_URL=<изолированная БД> pnpm --filter @portal/api exec vitest run src/publicapi/apiKey.lifecycle.test.ts`
Expected: FAIL для истёкшего ключа: текущая проверка смотрит только на `revoked_at`.

- [ ] **Step 3: Реализовать SQL-предикат активности**

```ts
`select id, owner_id, scopes from api_keys
 where key_hash = $1
   and revoked_at is null
   and (expires_at is null or expires_at > now())`
```

Тот же предикат добавить в `select count(*)` в `keys.route.ts`.

- [ ] **Step 4: Повторить поведенческие тесты**

Run: `DATABASE_URL=<изолированная БД> pnpm --filter @portal/api exec vitest run src/publicapi/apiKey.lifecycle.test.ts`
Expected: PASS.

### Task 3: Регрессия плана и документация

**Files:**
- Modify: `apps/api/src/publicapi/apiKey.lifecycle.test.ts`
- Modify: `docs/api.public.md`

**Interfaces:**
- Consumes: `api_keys_active_lookup_idx`, `api_keys_owner_active_idx` и SQL-предикат из Tasks 1–2.
- Produces: регрессия против последовательного сканирования активного пути и описание правила истечения без нового HTTP-поля.

- [ ] **Step 1: Проверить план запроса**

В тесте выполнить `set enable_seqscan = off`, затем `explain (format json)` для поиска по `key_hash`
и предикату активности. Рекурсивно проверить, что в плане есть `Index Scan` или `Index Only Scan` и
нет `Seq Scan` для `api_keys`.

- [ ] **Step 2: Обновить документацию**

В `docs/api.public.md` уточнить, что отозванный или истёкший ключ получает тот же
`401 invalid_api_key`; не добавлять новые поля запроса или ответа.

- [ ] **Step 3: Выполнить проверки**

Run: `pnpm --filter @portal/api run db:check-migrations-dup && DATABASE_URL=<изолированная БД> pnpm --filter @portal/api run db:check-schema-sync && DATABASE_URL=<изолированная БД> pnpm --filter @portal/api exec vitest run src/publicapi/apiKey.lifecycle.test.ts src/publicapi/keys.route.test.ts src/publicapi/v0.route.test.ts && pnpm --filter @portal/api run typecheck`
Expected: все команды завершаются с кодом `0`.

- [ ] **Step 4: Закоммитить и доставить в `origin/dev`**

```bash
git add apps/api/db apps/api/src/publicapi docs/api.public.md docs/superpowers/plans/2026-07-12-api-keys-lifecycle-integrity.md
git commit -m "fix(api): усилить жизненный цикл публичных ключей (MF-1284)"
git fetch origin dev && git rebase origin/dev && git push origin HEAD:dev
```
