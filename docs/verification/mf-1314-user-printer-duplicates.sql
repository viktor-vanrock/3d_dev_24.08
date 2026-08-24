-- MF-1314. Только read-only: SELECT и метаданные каталога PostgreSQL.
-- Не выполнять с правами, позволяющими DDL/DML; запросы не изменяют данные.

begin;
set transaction read only;

-- Каноническая связь и ограничения, защищающие повторные назначения.
select conrelid::regclass as table_name,
       conname,
       contype,
       convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('user_printers', 'printer_connections', 'device_shares')
  and contype in ('p', 'u', 'f', 'c')
order by 1, 2;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('user_printers', 'printer_connections', 'device_shares')
order by 1, 2;

-- Объём среза и заполненность ключевых связей.
select 'population' as check_name,
       count(*) as user_printer_rows,
       count(distinct user_id) as distinct_users,
       count(*) filter (where printer_id is not null) as catalog_linked_rows,
       count(*) filter (where connection_id is not null) as connector_rows,
       count(*) filter (where is_primary) as primary_rows
from public.user_printers;

select 'related_population' as check_name,
       (select count(*) from public.printer_connections) as connection_rows,
       (select count(*) from public.device_shares) as share_rows;

-- Жёсткий дубль connector-назначения: одна строка на (connection_id, external_ref).
-- NULL external_ref проверяется отдельно, потому что UNIQUE допускает несколько NULL.
select 'duplicate_connection_external_ref' as check_name,
       count(*) as duplicate_groups,
       coalesce(sum(row_count), 0) as duplicate_rows
from (
  select connection_id, external_ref, count(*) as row_count
  from public.user_printers
  where connection_id is not null
    and external_ref is not null
  group by connection_id, external_ref
  having count(*) > 1
) duplicates;

select 'connector_rows_without_external_ref' as check_name,
       count(*) as duplicate_groups,
       coalesce(sum(row_count), 0) as rows
from (
  select connection_id, count(*) as row_count
  from public.user_printers
  where connection_id is not null
    and external_ref is null
  group by connection_id
  having count(*) > 1
) candidates;

-- Одинаковая каталожная модель у одного пользователя — только кандидат:
-- несколько физических экземпляров одной модели допустимы.
select 'duplicate_user_catalog_candidate' as check_name,
       count(*) as candidate_groups,
       coalesce(sum(row_count), 0) as candidate_rows
from (
  select user_id, printer_id, count(*) as row_count
  from public.user_printers
  where printer_id is not null
  group by user_id, printer_id
  having count(*) > 1
) candidates;

-- Эвристика для ручных/agent-записей без стабильного instance-id.
select 'duplicate_user_brand_model_candidate' as check_name,
       count(*) as candidate_groups,
       coalesce(sum(row_count), 0) as candidate_rows
from (
  select user_id, lower(trim(brand)), lower(trim(model)), count(*) as row_count
  from public.user_printers
  group by user_id, lower(trim(brand)), lower(trim(model))
  having count(*) > 1
) candidates;

-- Повторное назначение primary не должно появляться; отсутствие primary — отдельный сигнал.
select 'multiple_primary_per_user' as check_name,
       count(*) as violating_users,
       coalesce(sum(primary_rows), 0) as rows
from (
  select user_id, count(*) as primary_rows
  from public.user_printers
  where is_primary
  group by user_id
  having count(*) > 1
) candidates;

select 'users_without_primary' as check_name,
       count(*) as users,
       coalesce(sum(printer_rows), 0) as printer_rows
from (
  select user_id,
         count(*) as printer_rows,
         count(*) filter (where is_primary) as primary_rows
  from public.user_printers
  group by user_id
  having count(*) filter (where is_primary) = 0
) candidates;

-- Повторный user↔device share и повторное подключение аккаунта к провайдеру.
select 'duplicate_device_share' as check_name,
       count(*) as duplicate_groups,
       coalesce(sum(row_count), 0) as duplicate_rows
from (
  select device_id, user_id, count(*) as row_count
  from public.device_shares
  group by device_id, user_id
  having count(*) > 1
) duplicates;

select 'duplicate_connection_account' as check_name,
       count(*) as duplicate_groups,
       coalesce(sum(row_count), 0) as duplicate_rows
from (
  select user_id, provider, count(*) as row_count
  from public.printer_connections
  group by user_id, provider
  having count(*) > 1
) duplicates;

-- Прямые разрывы связей, которые могли бы маскироваться под повторные назначения.
select 'connection_owner_mismatch' as check_name, count(*) as rows
from public.user_printers up
join public.printer_connections pc on pc.id = up.connection_id
where pc.user_id <> up.user_id;

select 'orphan_connection_reference' as check_name, count(*) as rows
from public.user_printers up
left join public.printer_connections pc on pc.id = up.connection_id
where up.connection_id is not null and pc.id is null;

select 'orphan_catalog_reference' as check_name, count(*) as rows
from public.user_printers up
left join public.machines m on m.id = up.printer_id
where up.printer_id is not null and m.id is null;

select 'orphan_share_device' as check_name, count(*) as rows
from public.device_shares ds
left join public.user_printers up on up.id = ds.device_id
where up.id is null;

-- Owner-share совпадает с user_printers.user_id по дизайну enroll; это не дубль.
select 'expected_owner_share_overlap' as check_name, count(*) as rows
from public.device_shares ds
join public.user_printers up on up.id = ds.device_id
where ds.role = 'owner' and ds.user_id = up.user_id;

rollback;
