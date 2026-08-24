# Сверка ORM/репозиторных запросов и SQL: user↔printer

Срез: 13.07.2026, ветка `dev`. Lineage: MF-1268 → MF-1076 → MF-1311 → MF-1346.

## Вывод

В `apps/api` отдельного ORM нет: доступ к данным выполняется через `pool.query` с параметризованным SQL. Каноническая пользовательская связь — `user_printers.user_id → users.id`; каталожная модель принтера — необязательная ссылка `user_printers.printer_id → machines.id`. Для live/device-поверхностей идентификатор устройства — это `user_printers.id`, а `device_state.device_id` и `device_shares.device_id` ссылаются именно на него.

## Матрица соответствий

| Поверхность | SQL-модель/таблица | Поля и join | Ownership/tenant-фильтр |
|---|---|---|---|
| `/me/printers`, `/me/activation` | `user_printers` | `id, printer_id, brand, model, build_volume, nozzle_mm, kinematics, link_source, verified, is_primary, created_at` | `where user_id = $1` |
| CRUD `/me/printers/:id` | `user_printers` | Сначала `select user_id ... where id = $1`, затем `update/delete ... where id = $1` | Сравнение `user_printers.user_id === session.id`; чужой ресурс — `403` |
| `/me/printers/:id/compat` | `user_printers` + `machines` | `up.printer_id = m.id`; `up.build_volume` имеет приоритет над `m.specs` | Сначала проверяется `up.user_id`, затем выполняется join |
| `/me/printers/:id/live` | `user_printers` + `device_state` | `ds.device_id = up.id`; `coalesce(ds.status, 'offline')` | `user_printers.user_id` проверяется до чтения состояния |
| `/me/devices/:deviceId/shares` | `user_printers` + `device_shares` + `users` | `device_shares.device_id = user_printers.id`; уникальность `(device_id,user_id)` | Владелец определяется только через `user_printers.user_id`; чужой device возвращает `404` |
| Enroll | `agents` → `user_printers` → `device_shares` → `device_state` | `agents.owner_id`; новая строка `user_printers.user_id`; owner-share и offline snapshot создаются в одной транзакции | `owner_id` enroll-кода переносится в `user_printers.user_id`; повторное использование кода закрывается `used_at` |
| Relay | `agents` + `user_printers` + `device_state` + `device_telemetry` | `user_printers.agent_id`; состояние адресуется `device_id = user_printers.id` | Агент допускается только если `agent_id` и `device_id` совпали; обновление `last_seen_at` ограничено этой строкой |
| Public API `/v0/printers*` | `user_printers` + `device_shares` | `PRINTER_SELECT`; роль вычисляется по owner-row или `device_shares` | API-key `owner_id` — tenant; owner получает `owner`, share — `operator/viewer/guest` |

## Фактические ограничения SQL

- `user_printers.user_id` — `not null`, внешний ключ на `users(id)` с каскадным удалением.
- `user_printers.printer_id` — nullable внешний ключ на `machines(id)`; ручная/agent-привязка может не иметь каталожной модели.
- `device_shares.device_id` и `device_state.device_id` — внешние ключи на `user_printers(id)` с каскадным удалением.
- `device_shares` имеет `unique(device_id, user_id)`; upsert в `shares.route.ts` соответствует этому ограничению.
- `user_printers` не имеет уникальности по `(user_id, printer_id)` или `(user_id, brand, model)`: одинаковые личные записи допустимы намеренно.
- Внешнего SQL-ограничения «ровно одна primary-запись на пользователя» нет; инвариант поддерживается API последовательностью `update ... where user_id` перед установкой `is_primary=true`.
- Индексы под tenant-чтение проверены в миграциях: `user_printers_user_idx`, `device_shares_user_idx`, `user_printers_agent_idx`; live-запрос использует PK `device_state.device_id`.

## Расхождения и риски

1. В коде название `printer_id` означает ссылку на каталожную таблицу `machines`, а `device_id` — ссылку на личную строку `user_printers`. Это не ошибка схемы, но опасное место для новых запросов: нельзя join-ить `device_state` по `printer_id`.
2. `/me/*` намеренно проверяет только прямое владение `user_printers.user_id`; шаринг через `device_shares` действует в public API/device-поверхностях и не расширяет `/me`.
3. ORM-слоя и декларативных repository-моделей для user↔printer нет, поэтому типы результата TypeScript не заменяют проверку схемы. Новые запросы должны сохранять параметризацию и явный tenant/owner predicate.

## Воспроизводимые read-only проверки

```sql
select tc.table_name, kcu.column_name, ccu.table_name as referenced_table, ccu.column_name as referenced_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu using (constraint_name, constraint_schema)
join information_schema.constraint_column_usage ccu using (constraint_name, constraint_schema)
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('user_printers', 'device_shares', 'device_state');

select indexname, indexdef
from pg_indexes
where tablename in ('user_printers', 'device_shares', 'device_state')
order by tablename, indexname;

select count(*) as rows_without_user
from user_printers up left join users u on u.id = up.user_id
where u.id is null;

select count(*) as rows_without_device
from device_state ds left join user_printers up on up.id = ds.device_id
where up.id is null;
```

Последние два запроса должны возвращать `0`; DDL/DML в рамках сверки не выполняются.
