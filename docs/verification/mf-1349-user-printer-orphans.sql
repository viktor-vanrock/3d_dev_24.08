-- MF-1349. Только SELECT: не выполнять с DDL/DML-правами.

-- Сиротская связь с владельцем.
select 'orphan_user_links' as check_name, count(*) as violations
from public.user_printers up
left join public.users u on u.id = up.user_id
where u.id is null;

-- Сиротская связь с legacy machine-каталогом. NULL printer_id не считается сиротой.
select 'orphan_machine_links' as check_name, count(*) as violations
from public.user_printers up
left join public.machines m on m.id = up.printer_id
where up.printer_id is not null
  and m.id is null;

-- Незаполненный владелец и базовая кардинальность.
select
  count(*) as user_printer_rows,
  count(distinct user_id) as distinct_users,
  count(*) filter (where user_id is null) as null_user_ids,
  count(*) filter (where printer_id is not null) as nonnull_printer_ids
from public.user_printers;

-- Потенциальные дубли одной и той же декларативной связи.
select user_id, printer_id, brand, model, count(*) as rows,
       array_agg(id order by id) as ids
from public.user_printers
group by user_id, printer_id, brand, model
having count(*) > 1
order by rows desc, user_id, brand, model;

-- Дубли connector-связи: защищены частичным UNIQUE-индексом.
select 'duplicate_connection_external_ref' as check_name,
       count(*) as duplicate_groups
from (
  select connection_id, external_ref
  from public.user_printers
  where connection_id is not null
  group by connection_id, external_ref
  having count(*) > 1
) duplicates;

-- Фактические ограничения и индексы, без изменения схемы.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'user_printers'
order by indexname;
