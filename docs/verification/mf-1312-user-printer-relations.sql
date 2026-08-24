-- MF-1312. Только SELECT: не выполнять с DDL/DML-правами.

select
  tc.constraint_type,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table,
  ccu.column_name as foreign_column
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
left join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
 and tc.table_schema = ccu.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'user_printers'
  and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

select
  conname,
  contype,
  convalidated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.user_printers'::regclass
order by contype, conname;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_printers'
order by ordinal_position;

select
  'user_printers' as table_name,
  count(*) as rows,
  count(*) filter (where user_id is null) as null_user_id,
  count(*) filter (where printer_id is null) as null_printer_id,
  count(*) filter (where connection_id is null) as null_connection_id,
  count(*) filter (where external_ref is null) as null_external_ref,
  count(*) filter (where link_source is null) as null_link_source,
  count(*) filter (where verified is null) as null_verified,
  count(*) filter (where is_primary is null) as null_is_primary,
  count(*) filter (where brand is null) as null_brand,
  count(*) filter (where model is null) as null_model
from user_printers;

select
  'user_counts' as label,
  count(*) as users_with_printers,
  min(cnt) as min_per_user,
  max(cnt) as max_per_user,
  round(avg(cnt)::numeric, 2) as avg_per_user
from (
  select user_id, count(*) cnt
  from user_printers
  group by user_id
) s;

select
  'user_with_multiple_printers' as label,
  count(*) as users
from (
  select user_id
  from user_printers
  group by user_id
  having count(*) > 1
) s;

select
  'connection_ref_dupes' as label,
  count(*) as violations
from (
  select connection_id, external_ref, count(*) c
  from user_printers
  where connection_id is not null
  group by 1, 2
  having count(*) > 1
) d;

select
  'connection_nonnull_rows' as label,
  count(*) as rows
from user_printers
where connection_id is not null
union all
select
  'connection_nonnull_distinct',
  count(distinct connection_id)
from user_printers
where connection_id is not null
union all
select
  'agent_nonnull_rows',
  count(*)
from user_printers
where agent_id is not null
union all
select
  'printer_nonnull_rows',
  count(*)
from user_printers
where printer_id is not null
union all
select
  'printer_nonnull_distinct',
  count(distinct printer_id)
from user_printers
where printer_id is not null;

