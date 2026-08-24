# MF-1348 — инвентаризация связи user↔printer

Срез: **2026-07-16**, база `portal_dev`, только `SELECT` внутри транзакции
`READ ONLY`. Проверка выполнена на `origin/dev` (`25d0e17b`).

Lineage: **MF-1268 → MF-1076 → MF-1311 → MF-1348**.

Это документ фактического состояния схемы и данных. Продуктовая схема и
публичный контракт этим шагом не изменяются. Контракт публичного API описан в
[docs/api.public.md](../api.public.md), прежде всего в разделах «Модель v0» и
«Доступ к конкретному принтеру».

## Каноническая связь

- Владение — `user_printers.user_id → users.id`.
- Идентификатор личного экземпляра — `user_printers.id`. Именно его используют
  `device_state.device_id`, `device_telemetry.device_id`, `device_jobs.device_id`,
  `device_shares.device_id` и `device_audit_log.device_id`.
- `user_printers.printer_id` — необязательная ссылка на нормализованный каталог
  `machines.id`; это не `device_id` и не ссылка на каталог `printers`.
- `printers` — отдельный публичный каталог карточек; прямого FK
  `user_printers → printers` в срезе нет. `printers.canonical_config_fingerprint`
  и `user_printers.config_fingerprint*` — fingerprint-атрибуты модели и
  экземпляра, а не идентификаторы.
- `device_shares` расширяет доступ к экземпляру, но не заменяет
  `user_printers.user_id` как ownership-связь.

## Фактические таблицы и поля

В срезе присутствуют 15 связанных таблиц: `users`, `user_printers`, `machines`,
`printers`, `printer_connections`, `agents`, `fleets`, `zones`, `device_shares`,
`device_state`, `device_telemetry`, `device_jobs`, `device_audit_log`,
`device_enroll_codes`, `user_api_keys`.

Каноническая строка `user_printers` фактически содержит 27 полей:

| Группа | Поля (тип) |
|---|---|
| Идентичность и каталог | `id` (`uuid`, PK), `user_id` (`uuid`, NOT NULL), `printer_id` (`uuid`, nullable), `brand` (`text`, NOT NULL), `model` (`text`, NOT NULL), `build_volume` (`jsonb`), `nozzle_mm` (`numeric`), `kinematics` (`text`) |
| Источник и коннектор | `link_source` (`text`, NOT NULL), `verified` (`boolean`, default `false`), `is_primary` (`boolean`, default `false`), `created_at` (`timestamptz`, NOT NULL), `connection_id` (`uuid`), `external_ref` (`text`), `status` (`text`) |
| Агент и эксплуатация | `agent_id` (`uuid`), `firmware_class` (`text`), `last_seen_at` (`timestamptz`), `capabilities` (`jsonb`, NOT NULL, default `{}`), `fleet_id` (`uuid`), `zone_id` (`uuid`) |
| Fingerprint MF-1076 | `config_fingerprint` (`text`), `config_fingerprint_source` (`text`), `config_fingerprint_stock_declared` (`boolean`), `config_fingerprint_updated_at` (`timestamptz`) |
| Локальное подключение | `lan_endpoint` (`text`), `connection_mode` (`text`) |

Связанные device-таблицы используют следующие поля:

| Таблица | Фактическое назначение и ключевые поля |
|---|---|
| `device_shares` | `device_id → user_printers.id`, `user_id → users.id`, `role`; уникальная пара `(device_id, user_id)` |
| `device_state` | одна горячая строка на экземпляр: PK `device_id`, `status`, `progress`, `job_id`, `metrics`, `seq`, `updated_at` |
| `device_telemetry` | история: PK `id`, `device_id`, `recorded_at`, `status`, `progress`, `metrics`, `seq` |
| `device_jobs` | история заданий: PK `id`, `device_id`, nullable `model_id`, `status`, `progress`, timestamps |
| `device_audit_log` | append-only события: PK `id`, `device_id`, nullable `actor_user_id`, `action`, `meta`, `created_at` |
| `device_enroll_codes` | одноразовая привязка: `owner_id`, уникальный `code_hash`, `device_id`, `agent_id`, TTL/использование |

Для lineage MF-1076 в схеме также есть `user_api_keys`: `user_id`, `scope`,
`provider`, `key_hash`/`secret_enc`, `status`, `rotated_from_id`. Это слой
учётных данных, а не дополнительная запись владения принтером.

## Ограничения и индексы

### Внешние ключи

| Источник | Назначение | Удаление | Валидация |
|---|---|---|---|
| `user_printers.user_id` | `users.id` | `CASCADE` | validated |
| `user_printers.printer_id` | `machines.id` | — | **`NOT VALID`** |
| `user_printers.connection_id` | `printer_connections.id` | `CASCADE` | validated |
| `user_printers.agent_id` | `agents.id` | `SET NULL` | validated |
| `user_printers.fleet_id` | `fleets.id` | `SET NULL` | validated |
| `user_printers.zone_id` | `zones.id` | `SET NULL` | validated |
| `device_shares.device_id` / `device_state.device_id` / `device_telemetry.device_id` / `device_jobs.device_id` / `device_audit_log.device_id` | `user_printers.id` | `CASCADE` | validated |
| `device_state.job_id` | `device_jobs.id` | `SET NULL` | validated |
| `device_enroll_codes.device_id` | `user_printers.id` | `SET NULL` | validated |

На `user_printers` есть PK `id` и CHECK-ограничения для `link_source`
(`connector|popular|search|manual|agent|ip`), `firmware_class`
(`klipper|octoprint|bambu|prusa|creality`), `connection_mode`
(`list|managed-local|managed-bridge`), согласованной пары
`connection_mode/link_source/agent_id`, формы `lan_endpoint` и источника LAN,
а также `config_fingerprint_source` (`agent|declared`).

На device-поверхности фактические CHECK-ограничения ограничивают роли
`owner|operator|viewer|guest`, состояния и прогресс 0..100, неотрицательный
`seq`, статусы заданий и непустой `device_audit_log.action`. У
`device_shares` есть UNIQUE `(device_id, user_id)`, у `printer_connections` —
UNIQUE `(user_id, provider)`, у пары коннектора — частичный UNIQUE-индекс
`user_printers_connection_ref_idx` на `(connection_id, external_ref)`.

Индексы tenant/device-чтения: `user_printers_user_idx`,
`user_printers_agent_idx`, `user_printers_lan_endpoint_idx`,
`device_shares_user_idx`, `device_jobs_device_idx`,
`device_telemetry_device_recorded_idx`, `device_audit_log_device_idx`.
Полный перечень фактических индексов и определений возвращает SQL-файл
инвентаризации.

## Факты среза без раскрытия идентификаторов

| Проверка | Результат |
|---|---:|
| Строки `user_printers` | 85 |
| Пользователи с записью принтера | 72 |
| Принтеров на пользователя (min / max / avg) | 1 / 14 / 1,18 |
| `user_printers.printer_id` заполнен | 2 |
| `connection_id` заполнен | 0 |
| `agent_id` заполнен | 12 |
| Fingerprint экземпляра заполнен | 0 |
| Canonical fingerprint каталога заполнен | 0 |
| Сироты `user_id`, `printer_id`, `connection_id`, `agent_id` | 0 / 0 / 0 / 0 |
| Сироты `device_state`, `device_shares`, `device_telemetry`, `device_jobs` | 0 / 0 / 0 / 0 |

Распределение `user_printers`: `manual/list` — 46, `popular/list` — 24,
`agent/managed-bridge` — 11, `agent` с пустым `connection_mode` — 1,
`connector` — 1, `ip/managed-local` — 1, `search/list` — 1.

Прочие row counts среза: `users` — 1061, `machines` — 3, `printers` — 3,
`agents` — 20, `device_shares` — 9, `device_state` — 12,
`device_telemetry` — 4, `device_audit_log` — 19,
`device_enroll_codes` — 22, `user_api_keys` — 1; `fleets`, `zones`,
`printer_connections`, `device_jobs` — 0.

## Воспроизводимость

SQL-команды находятся в
[`docs/audits/user.printer.inventory.mf1348.sql`](user.printer.inventory.mf1348.sql).
Запуск на dev:

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off \
  -f docs/audits/user.printer.inventory.mf1348.sql
```

Скрипт начинает `BEGIN READ ONLY` и завершается `ROLLBACK`; в нём нет DDL/DML,
выборки UUID, имён пользователей, endpoint-ов или содержимого credentials.

## Свежесть оснований

Проверено через `git log -1 --format="%h | %ad | %an" --date=short -- <file>`:

| Основание | Свежесть |
|---|---|
| `docs/api.public.md` | `4ac5d4bf | 2026-07-15 | Test` |
| `docs/architecture/device.tables.md` | `e933d7f4 | 2026-07-12 | Back` |
| `docs/epics/domain.model.md` | `512f228c | 2026-07-13 | Docs` |
| `apps/api/db/migrations/20260710310000_device_fleet_foundation.sql` | `a1812d74 | 2026-07-10 | Data` |
| `apps/api/db/migrations/20260711290000_user_api_keys_config_fingerprint.sql` | `692f1af4 | 2026-07-11 | Data` |

