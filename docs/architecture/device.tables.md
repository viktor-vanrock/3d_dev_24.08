# Инвентаризация таблиц устройств

Статус проверки: 2026-07-12, dev (`portal_dev`). Контур — только SQL и документация; DDL и изменение данных в рамках MF-1267 не выполнялись.

## Каноническая модель

В текущей схеме «у пользователя есть принтер» — это `user_printers`, а отдельной таблицы `devices` нет. Таблицы с префиксом `device_` хранят эксплуатационные факты вокруг этой записи:

| Таблица | Назначение и ключ | Основные связи |
|---|---|---|
| `user_printers` | Экземпляр принтера пользователя; PK `id`, обязательный `user_id`, `printer_id` nullable, `catalog_printer_id` nullable (MF-1097), `link_source`, `firmware_class`, `capabilities`, `config_fingerprint*`, `agent_id` | `user_id → users`, `printer_id → machines` (`NOT VALID`), `catalog_printer_id → printers`, `agent_id → agents`, `connection_id → printer_connections`, `fleet_id → fleets`, `zone_id → zones` |
| `agents` | Процесс агента, не отдельное устройство; PK `id`, `owner_id`, online/offline и revoke-поля | `owner_id → users` |
| `fleets` / `zones` | Задел для группировки; PK `id` | `fleets.owner_id → users`, `zones.fleet_id → fleets` |
| `device_shares` | Дополнительный доступ к `user_printers`; PK `id`, unique `(device_id,user_id)`, роли `owner/operator/viewer/guest` | `device_id → user_printers`, `user_id → users` |
| `device_state` | Перезаписываемый hot snapshot, одна строка на устройство; PK/FK `device_id`, `status`, `progress`, `job_id`, `metrics`, `seq` | `device_id → user_printers`, `job_id → device_jobs` |
| `device_telemetry` | История снимков; PK `id`, индекс `(device_id, recorded_at desc)`, `seq` | `device_id → user_printers` |
| `device_jobs` | История печатей; PK `id`, `status`, `progress`, optional `model_id` | `device_id → user_printers`, `model_id → models` |
| `device_audit_log` | Append-only аудит действий; PK `id`, `actor_user_id` nullable | `device_id → user_printers`, `actor_user_id → users` |
| `device_enroll_codes` | Хэш одноразового кода, TTL/использование/revoke; PK `id`, unique `code_hash` | `owner_id → users`, `device_id → user_printers`, `agent_id → agents` |
| `api_keys` | Bearer-ключи публичного API v0; PK `id`, unique `key_hash`, scopes `read/control` | `owner_id → users`; `device_commands.api_key_id → api_keys` |
| `device_commands` | Очередь `gcode/start/pause/stop`; PK `id`, `correlation_id`, status `queued/acked/rejected`, idempotency/scope-поля | `device_id → user_printers`, `api_key_id → api_keys` |

Каскадная семантика важна: удаление `user_printers` удаляет state/telemetry/jobs/shares/audit/commands; удаление пользователя каскадирует его парк, агенты, ключи и enroll-коды. Удаление модели не стирает job (`device_jobs.model_id ... on delete set null`).

## Связь с MF-1076, MF-884 и MF-1050

- **MF-1076.** Таблица `user_api_keys` действительно существует отдельно от старой `api_keys`. В ней scopes `printer/slicing/public_api`, хэшированные ключи (`key_hash`) и обратимо зашифрованные vendor-секреты (`secret_enc`). На конкретном экземпляре `user_printers` лежат `config_fingerprint`, `config_fingerprint_source` (`agent|declared`), `config_fingerprint_stock_declared`, `config_fingerprint_updated_at`; на каталожной модели `printers` — `canonical_config_fingerprint`. Это два уровня: instance и model, они не смешаны.
- **MF-884.** Поля `support_level`, `firmware_ready`, `firmware_public`, `connector_type`, `firmware_repo` и таблица `community_firmware` относятся к каталогу `printers`, а не к `user_printers`/`device_state`. `community_firmware.printer_id → printers.id` nullable, `git_url` unique. В `user_printers` «живой» протокол представлен отдельно через `firmware_class` и `link_source`.
- **MF-1050.** Каталожные `GET /printers` и `GET /printers/:slug` уже сериализуют пять полей MF-884 в `apps/api/src/printers/serialize.ts`. Это не тот же endpoint, что `/v0/printers*`: публичный device API строит ответ из `user_printers + device_state` и отдаёт `connector_type` как `firmware_class`; `support_level` каталожной модели там намеренно не выбирается.

## Расхождения и границы контракта

1. `user_printers.printer_id` ссылается на `machines`, а поля MF-884 и публичный каталог `GET /printers*` живут на `printers`. Прямого FK `user_printers → printers` нет — `printer_id` нельзя считать join к каталожному `printers`. **MF-1097** добавил отдельную `catalog_printer_id → printers` (FK, nullable): `POST /me/printers` пишет её при `link_source='catalog'` (выбор из `/printers`/`/printers/<slug>`), `printer_id` при этом не трогается. Полный свод `machines`→`printers` в одну колонку — отдельная миграция Data (MF-405/§9.4 «риск раздвоенного канона»), не выполнена.
2. `device_state` и `device_telemetry` имеют `seq >= 0`, но retention для telemetry в схеме не задан. API документирует чтение истории с `limit ≤ 500`; TTL/партиционирование остаются отдельной операционной задачей.
3. Владелец определяется `user_printers.user_id`; `device_shares` — только дополнительный доступ. Это совпадает с `docs/api.public.md`: owner/operator могут управлять, viewer/guest — только читать.
4. `device_commands` хранит принятую очередь. Доставка через relay не является SQL-фактом этой таблицы; для v0 статус `queued` не доказывает доставку на физический принтер.

## Воспроизводимая read-only проверка dev

Команды выполняются на VDS с dev-секретом, без `INSERT/UPDATE/DELETE/DDL`:

```sh
set -a; . "$HOME/portal.api-dev.env"; set +a
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off \
  -c "select current_database(), current_user, now();" \
  -c "select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema='public' and table_name in
       ('user_printers','agents','fleets','zones','device_shares','device_audit_log',
        'device_state','device_jobs','device_telemetry','device_enroll_codes','api_keys','device_commands')
       order by table_name, ordinal_position;" \
  -c "select conrelid::regclass as table_name, conname,
              pg_get_constraintdef(oid) as definition
       from pg_constraint
       where connamespace='public'::regnamespace
         and conrelid::regclass::text in
       ('user_printers','agents','fleets','zones','device_shares','device_audit_log',
        'device_state','device_jobs','device_telemetry','device_enroll_codes','api_keys','device_commands')
         and contype in ('p','u','f') order by 1,2;"
```

Фактические counts на момент проверки:

```text
agents 3                 api_keys 1              device_audit_log 5
device_commands 0        device_enroll_codes 4   device_jobs 0
device_shares 3          device_state 3          device_telemetry 4
fleets 0                 user_printers 54        zones 0
```

Read-only инварианты для повторной проверки сирот и нарушений enum/nullable:

```sql
select 'state_without_printer' as check, count(*)
from device_state s left join user_printers p on p.id=s.device_id where p.id is null
union all select 'telemetry_without_printer', count(*)
from device_telemetry t left join user_printers p on p.id=t.device_id where p.id is null
union all select 'share_without_printer', count(*)
from device_shares s left join user_printers p on p.id=s.device_id where p.id is null
union all select 'invalid_firmware_class', count(*)
from user_printers where firmware_class is not null
  and firmware_class not in ('klipper','octoprint','bambu','prusa','creality')
union all select 'invalid_share_role', count(*)
from device_shares where role not in ('owner','operator','viewer','guest');
```

Ожидаемый и фактический результат для dev: все пять counts равны `0`. Проверка каталожного/API-разрыва без чтения секретов:

```sql
select count(*) as user_printers_with_machine_ref
from user_printers where printer_id is not null;
select count(*) as catalog_printers_with_support_fields
from printers
where support_level is not null or connector_type is not null
   or firmware_ready is not null or firmware_public is not null or firmware_repo is not null;
```

Результат dev: `user_printers_with_machine_ref = 0`, `catalog_printers_with_support_fields = 1`.

Итог: схема device-контура согласована с `docs/architecture/printer.server.md` и `docs/api.public.md` на уровне ownership/state/telemetry/commands; единственный структурный разрыв для дальнейшего решения — `machines` против каталожного `printers`, а не отсутствие таблиц или FK device-контура.
