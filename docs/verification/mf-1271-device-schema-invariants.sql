-- MF-1271. Только SELECT: не выполнять с DDL/DML-правами.

select 'orphan_device_state' as check, count(*) as violations
from device_state s left join user_printers p on p.id = s.device_id
where p.id is null
union all select 'orphan_device_telemetry', count(*)
from device_telemetry t left join user_printers p on p.id = t.device_id
where p.id is null
union all select 'orphan_device_jobs', count(*)
from device_jobs j left join user_printers p on p.id = j.device_id
where p.id is null
union all select 'orphan_device_shares', count(*)
from device_shares s left join user_printers p on p.id = s.device_id
where p.id is null
union all select 'orphan_user_printer_owner', count(*)
from user_printers p left join users u on u.id = p.user_id
where u.id is null
union all select 'orphan_share_user', count(*)
from device_shares s left join users u on u.id = s.user_id
where u.id is null;

select 'duplicate_device_share' as check, count(*) as violations
from (select device_id, user_id from device_shares group by device_id, user_id having count(*) > 1) d
union all select 'duplicate_user_api_key_hash', count(*)
from (select key_hash from user_api_keys where key_hash is not null group by key_hash having count(*) > 1) d
union all select 'duplicate_slice_cache_key', count(*)
from (select slice_key from slice_cache_entries group by slice_key having count(*) > 1) d;

select 'null_or_non_object_capabilities' as check, count(*) as violations
from user_printers
where capabilities is null or jsonb_typeof(capabilities) <> 'object'
union all select 'invalid_fingerprint_source', count(*)
from user_printers
where config_fingerprint_source is not null
  and config_fingerprint_source not in ('agent', 'declared')
union all select 'invalid_share_role', count(*)
from device_shares
where role not in ('owner', 'operator', 'viewer', 'guest')
union all select 'invalid_api_key_shape', count(*)
from user_api_keys
where (scope = 'printer' and (provider is null or secret_enc is null or key_hash is not null))
   or (scope in ('slicing', 'public_api') and (provider is not null or key_hash is null or secret_enc is not null));

select 'cache_hit_orphans' as check, count(*) as violations
from slice_cache_hits h left join slice_cache_entries e on e.slice_key = h.slice_key
where e.slice_key is null;

select 'api_shape_mismatches' as check,
       count(*) filter (where capabilities <> '{}'::jsonb) as capabilities_not_exposed,
       count(*) filter (where firmware_class is not null and firmware_class = '') as blank_connector_type
from user_printers;

select 'fingerprint_scope_mismatches' as check, count(*) as violations
from user_printers
where config_fingerprint_source = 'agent' and agent_id is null;
