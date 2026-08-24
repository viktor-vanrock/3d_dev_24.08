# MF-1269: аудит capability-модели устройства

Дата проверки: 2026-07-12. Контур: SQL и `docs/architecture/`.

## Фактическая модель

Каноническая запись экземпляра устройства — `user_printers`. Поле
`user_printers.capabilities jsonb not null default '{}'` хранит обнаруженные
агентом живые возможности конкретного экземпляра. Текущий снэпшот состояния и
история телеметрии разделены: `device_state.metrics` — перезаписываемый
снэпшот, `device_telemetry.metrics` — временной ряд. Связи устройства:

| Связь | Поле | Кардинальность/смысл |
|---|---|---|
| владелец | `user_printers.user_id → users.id` | один владелец, каскадное удаление |
| агент | `user_printers.agent_id → agents.id` | много устройств на один агент, `SET NULL` |
| парк/зона | `fleet_id → fleets.id`, `zone_id → zones.id` | необязательная группировка, `SET NULL` |
| состояние | `device_state.device_id → user_printers.id` | 0..1 горячий снэпшот |
| телеметрия | `device_telemetry.device_id → user_printers.id` | 0..N исторических записей |
| задания | `device_jobs.device_id → user_printers.id` | 0..N заданий |
| доступ | `device_shares.device_id → user_printers.id` | 0..N ролей, уникально на пользователя |

Реляционные enum-ограничения проверяются для `firmware_class`, статуса
`device_state`, статуса задания и роли шаринга. `capabilities` намеренно
остаётся расширяемым JSONB; его значения должны контролироваться контрактом
агента, а не DDL.

## Воспроизводимые read-only проверки

Запросы рассчитаны на PostgreSQL и не содержат DDL/изменений данных. Их можно
выполнить против dev-базы, подставив `$1` при необходимости:

```sql
-- 1. Структура и default capability-поля.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'user_printers' and column_name in ('id','user_id','agent_id','firmware_class','capabilities','fleet_id','zone_id'))
    or (table_name in ('device_state','device_telemetry','device_jobs','device_shares') and column_name in ('device_id','status','metrics','role')))
order by table_name, ordinal_position;

-- 2. Неизвестные/не-объектные JSON capabilities.
select id, jsonb_typeof(capabilities) as value_type, capabilities
from user_printers
where capabilities is null or jsonb_typeof(capabilities) <> 'object';

-- 3. Пустые capability-объекты на агентских устройствах.
select count(*) filter (where agent_id is not null and capabilities = '{}'::jsonb) as agent_without_capabilities,
       count(*) filter (where agent_id is not null) as agent_devices,
       count(*) as all_devices
from user_printers;

-- 4. Неконсистентные связи device → agent/fleet/zone (ожидается 0 строк).
select up.id, up.agent_id, up.fleet_id, up.zone_id
from user_printers up
left join agents a on a.id = up.agent_id
left join fleets f on f.id = up.fleet_id
left join zones z on z.id = up.zone_id
where (up.agent_id is not null and a.id is null)
   or (up.fleet_id is not null and f.id is null)
   or (up.zone_id is not null and z.id is null);

-- 5. Сверка живых устройств с состоянием и телеметрией.
select up.id,
       (ds.device_id is not null) as has_state,
       exists (select 1 from device_telemetry dt where dt.device_id = up.id) as has_telemetry
from user_printers up
where up.agent_id is not null
order by up.created_at desc;
```

## Результат сверки schema ↔ API ↔ архитектура

1. Схема содержит полноценную capability-точку (`user_printers.capabilities`) и
   связи состояния/телеметрии/заданий. Неизвестных enum-значений в DDL не
   допускается; содержимое JSONB DDL не валидирует.
2. `docs/architecture/printer.server.md §2.2.2` правильно отделяет capability
   драйвера от фактической достижимости через relay и помечает неизвестные
   server-side пути. Это источник истины для статуса реализации, а не
   интерфейс драйвера.
3. Расхождение: `apps/api/src/publicapi/v0.route.ts` выбирает
   `up.firmware_class` и сериализует его как `connector_type`, но не выбирает и
   не отдаёт `up.capabilities`. Поэтому публичный API v0 не раскрывает
   фактические capabilities экземпляра, а `connector_type` там означает класс
   прошивки (`klipper`, `octoprint` и т.п.), тогда как каталог использует
   протокольные значения (`moonraker`, `bambu-mqtt`, `prusa-link`, ...).
   Это API-расхождение зафиксировано для отдельной карточки; в рамках MF-1269
   DDL и данные не менялись.

Итог: модель БД покрывает требуемые типы и связи; основной обнаруженный gap —
публичный API-контракт capabilities/connector_type, а не отсутствие таблиц или
связей.
