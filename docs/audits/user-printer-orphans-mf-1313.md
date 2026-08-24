# Read-only проверка сиротских связей user↔printer (MF-1313)

Срез выполнен 2026-07-13 в `portal_dev` под ролью `portal_dev`. Проверка только
читает данные: `SELECT` и запросы к `information_schema`/каталогу PostgreSQL;
`INSERT`/`UPDATE`/`DELETE`/DDL не выполнялись.

## Lineage и каноническая связь

Контекст: `MF-1268` → `MF-1076` → `MF-1313`. Каноническая запись владения —
`user_printers.user_id → users.id`; необязательная каталожная ссылка —
`user_printers.printer_id → machines.id`. Доступ к записи устройства в device API
адресуется через `user_printers.id`, а не через `printer_id`.

Основания в репозитории:

- `docs/epics/domain.model.md`, разделы «Мастерская» и «Станки: не “принтеры”, а
  `machines`»;
- `docs/architecture/device.tables.md`, раздел «Каноническая модель»;
- `docs/api.public.md`, раздел «Доступ к конкретному принтеру».

В комментарии к MF-1313 указан путь `docs/architecture/domain.model.md`, но такого
файла в ветке нет; фактический архитектурный источник доменной модели —
`docs/epics/domain.model.md`.

## Команды и фактические результаты

Подключение выполнялось через dev-секрет на хосте, значение `DATABASE_URL` в
репозиторий и отчёт не попало:

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off
```

Проверка количества записей и прямых разрывов:

```sql
select 'total_user_printers', count(*) from user_printers
union all select 'manual_without_machine_ref', count(*)
  from user_printers where printer_id is null
union all select 'with_machine_ref', count(*)
  from user_printers where printer_id is not null
union all select 'missing_user', count(*)
  from user_printers up left join users u on u.id = up.user_id
  where u.id is null
union all select 'missing_machine', count(*)
  from user_printers up left join machines m on m.id = up.printer_id
  where up.printer_id is not null and m.id is null
union all select 'inactive_user', count(*)
  from user_printers up join users u on u.id = up.user_id
  where u.status <> 'active'
union all select 'discontinued_machine', count(*)
  from user_printers up join machines m on m.id = up.printer_id
  where m.discontinued is true;
```

Фактический результат:

| Проверка | Строки/нарушения |
|---|---:|
| `total_user_printers` | 55 |
| `manual_without_machine_ref` | 54 |
| `with_machine_ref` | 1 |
| `missing_user` | 0 |
| `missing_machine` | 0 |
| `inactive_user` | 0 |
| `discontinued_machine` | 0 |

Дополнительно на срезе было 1003 пользователя и 2 записи каталога `machines`;
обе записи каталога имели `status='active'`, `discontinued=false`, а все 1003
пользователя — `status='active'`.

Проверка опциональных ссылок устройства и зависимых device-записей:

```sql
select 'missing_agent', count(*)
from user_printers up left join agents a on a.id = up.agent_id
where up.agent_id is not null and a.id is null
union all select 'missing_fleet', count(*)
from user_printers up left join fleets f on f.id = up.fleet_id
where up.fleet_id is not null and f.id is null
union all select 'missing_zone', count(*)
from user_printers up left join zones z on z.id = up.zone_id
where up.zone_id is not null and z.id is null
union all select 'missing_connection', count(*)
from user_printers up left join printer_connections c on c.id = up.connection_id
where up.connection_id is not null and c.id is null
union all select 'missing_device_for_share', count(*)
from device_shares s left join user_printers up on up.id = s.device_id
where up.id is null
union all select 'missing_device_for_state', count(*)
from device_state s left join user_printers up on up.id = s.device_id
where up.id is null
union all select 'missing_device_for_telemetry', count(*)
from device_telemetry t left join user_printers up on up.id = t.device_id
where up.id is null
union all select 'missing_device_for_job', count(*)
from device_jobs j left join user_printers up on up.id = j.device_id
where up.id is null;
```

Все восемь дополнительных проверок вернули `0`.

## Вывод и ограничения

На срезе 2026-07-13 сиротских связей user↔printer не найдено: ни одна запись
`user_printers` не указывает на отсутствующего/неактивного пользователя, а
единственная ненулевая `printer_id` указывает на существующую активную запись
`machines`. 54 строки являются ручными/непривязанными к каталогу экземплярами —
это допустимо, поскольку `printer_id` nullable.

В схеме FK `user_printers_printer_id_fkey` отмечен `NOT VALID`; поэтому результат
подтверждает текущий срез и не заменяет отдельную операцию `VALIDATE CONSTRAINT`.
Удалённые пользователи в текущей БД представлены статусом `users.status`, а не
колонкой `deleted_at`; на срезе таких записей среди владельцев нет.
