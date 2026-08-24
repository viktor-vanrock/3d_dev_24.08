-- MF-1348. Инвентаризация user↔printer.
-- Только чтение: транзакция READ ONLY, в конце ROLLBACK.

begin read only;

-- 1. Таблицы, входящие в ownership/device/API-контур.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'users', 'user_printers', 'machines', 'printers', 'printer_connections',
    'agents', 'fleets', 'zones', 'device_shares', 'device_state',
    'device_telemetry', 'device_jobs', 'device_audit_log',
    'device_enroll_codes', 'user_api_keys'
  )
order by table_name;

-- 2. Фактические поля, типы, nullability и defaults без чтения данных.
select table_name, ordinal_position, column_name, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'users', 'user_printers', 'machines', 'printers', 'printer_connections',
    'agents', 'fleets', 'zones', 'device_shares', 'device_state',
    'device_telemetry', 'device_jobs', 'device_audit_log',
    'device_enroll_codes', 'user_api_keys'
  )
order by table_name, ordinal_position;

-- 3. PK/FK/UNIQUE/CHECK и их фактическая валидация.
select conrelid::regclass::text as table_name,
       conname,
       case contype
         when 'p' then 'PRIMARY KEY'
         when 'f' then 'FOREIGN KEY'
         when 'u' then 'UNIQUE'
         when 'c' then 'CHECK'
         else contype::text
       end as constraint_type,
       convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in (
    'user_printers', 'device_shares', 'device_state', 'device_telemetry',
    'device_jobs', 'device_audit_log', 'device_enroll_codes',
    'printer_connections', 'user_api_keys'
  )
  and contype in ('p', 'f', 'u', 'c')
order by table_name, constraint_type, conname;

-- 4. Индексы, включая частичные UNIQUE-индексы.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'user_printers', 'device_shares', 'device_state', 'device_telemetry',
    'device_jobs', 'device_audit_log', 'device_enroll_codes',
    'printer_connections', 'user_api_keys'
  )
order by tablename, indexname;

-- 5. Агрегаты без UUID, PII и credentials.
select
  (select count(*) from user_printers) as user_printers_rows,
  (select count(distinct user_id) from user_printers) as owners,
  (select min(n) from (select user_id, count(*) n from user_printers group by user_id) s) as min_per_owner,
  (select max(n) from (select user_id, count(*) n from user_printers group by user_id) s) as max_per_owner,
  (select round(avg(n)::numeric, 2) from (select user_id, count(*) n from user_printers group by user_id) s) as avg_per_owner,
  (select count(*) from user_printers where printer_id is not null) as with_machine_ref,
  (select count(*) from user_printers where connection_id is not null) as with_connection_ref,
  (select count(*) from user_printers where agent_id is not null) as with_agent_ref,
  (select count(*) from user_printers where config_fingerprint is not null) as with_instance_fingerprint,
  (select count(*) from printers where canonical_config_fingerprint is not null) as with_canonical_fingerprint;

select link_source, coalesce(connection_mode, '<NULL>') as connection_mode, count(*)
from user_printers
group by link_source, connection_mode
order by link_source, connection_mode;

select table_name, rows
from (
  values
    ('users', (select count(*) from users)),
    ('user_printers', (select count(*) from user_printers)),
    ('machines', (select count(*) from machines)),
    ('printers', (select count(*) from printers)),
    ('printer_connections', (select count(*) from printer_connections)),
    ('agents', (select count(*) from agents)),
    ('fleets', (select count(*) from fleets)),
    ('zones', (select count(*) from zones)),
    ('device_shares', (select count(*) from device_shares)),
    ('device_state', (select count(*) from device_state)),
    ('device_telemetry', (select count(*) from device_telemetry)),
    ('device_jobs', (select count(*) from device_jobs)),
    ('device_audit_log', (select count(*) from device_audit_log)),
    ('device_enroll_codes', (select count(*) from device_enroll_codes)),
    ('user_api_keys', (select count(*) from user_api_keys))
) as counts(table_name, rows)
order by table_name;

-- 6. Проверка сиротских ссылок. Ожидаемый результат — нули.
select
  (select count(*) from user_printers up
   left join users u on u.id = up.user_id where u.id is null) as orphan_user_refs,
  (select count(*) from user_printers up
   left join machines m on m.id = up.printer_id
   where up.printer_id is not null and m.id is null) as orphan_machine_refs,
  (select count(*) from user_printers up
   left join printer_connections pc on pc.id = up.connection_id
   where up.connection_id is not null and pc.id is null) as orphan_connection_refs,
  (select count(*) from user_printers up
   left join agents a on a.id = up.agent_id
   where up.agent_id is not null and a.id is null) as orphan_agent_refs,
  (select count(*) from device_state ds
   left join user_printers up on up.id = ds.device_id where up.id is null) as orphan_state_refs,
  (select count(*) from device_shares ds
   left join user_printers up on up.id = ds.device_id where up.id is null) as orphan_share_refs,
  (select count(*) from device_telemetry dt
   left join user_printers up on up.id = dt.device_id where up.id is null) as orphan_telemetry_refs,
  (select count(*) from device_jobs dj
   left join user_printers up on up.id = dj.device_id where up.id is null) as orphan_job_refs;

rollback;
