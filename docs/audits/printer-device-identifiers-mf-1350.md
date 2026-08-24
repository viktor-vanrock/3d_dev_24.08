# Сверка идентификаторов printer и device

Срез: 16.07.2026, `portal_dev`; только `SELECT` в транзакции `READ ONLY`.
Lineage: MF-1268 → MF-1076 → MF-1311 → MF-1350.

## Границы и канон

Проверка относится к серверному владению `portal.ru`. UltraPrint не хранит
пользовательский каталог: его агент принимает непрозрачный `device_id` и обязан
сопоставлять его с target-bound identity. Поэтому нельзя переносить server-side
каталог или связи владения в device runtime.

| Имя в контракте | Фактический носитель | Смысл | Допустимый join |
|---|---|---|---|
| `user_printers.id` | `user_printers` | личная запись владения; это device identity для live-контуров | `device_state.device_id`, `device_shares.device_id` → `user_printers.id` |
| `user_printers.printer_id` | `user_printers` | необязательная ссылка на нормализованный каталог станков | `user_printers.printer_id` → `machines.id` |
| `printers.id` | `printers` | публичный каталог карточек принтеров и их canonical fingerprint | отдельного FK к `user_printers` нет |
| `config_fingerprint` | `user_printers` / `printers` | конфигурация конкретного экземпляра / каноническая конфигурация модели | не является ни `device_id`, ни `printer_id` |

Основания: `docs/epics/domain.model.md` («Мастерская», `user_printers` и
`machines`), `docs/api.public.md` («Доступ к конкретному принтеру»),
`apps/api/db/migrations/20260710310000_device_fleet_foundation.sql` и
`apps/api/db/migrations/20260711290000_user_api_keys_config_fingerprint.sql`.

## Факты dev-среза

В фактических FK `device_state.device_id` и `device_shares.device_id` ссылаются
на `user_printers.id`; `user_printers.printer_id` ссылается на `machines.id`.
Ссылки на таблицу `printers` в этой цепочке отсутствуют.

| Проверка | Результат |
|---|---:|
| `user_printers` | 85 |
| `machines` | 3 |
| `printers` | 3 |
| личные записи без `machine`-ссылки | 83 |
| сиротские `user_printers.user_id` | 0 |
| сиротские `user_printers.printer_id` | 0 |
| сиротские `device_state.device_id` | 0 |
| сиротские `device_shares.device_id` | 0 |
| `agent_id`, не существующий в `agents` | 0 |

Распределение личных записей: 12 `agent` (11 `managed-bridge`, 1 без режима),
1 `connector`, 1 `ip`/`managed-local`, 46 `manual`/`list`, 24 `popular`/`list`
и 1 `search`/`list`. Только две строки имеют `printer_id`.

## Неоднозначности и владельцы следующих действий

1. **Data:** одна из двух каталожных ссылок содержит `Bambu X1C`, но указывает
   на `Test Machine Vendor / Test Machine`; после нормализации не совпадают и
   бренд, и модель. Это тестовая либо ошибочная production-like привязка. Не
   исправлялась этой read-only карточкой: нужно отдельное решение и миграция
   данных с проверкой владельца записи.
2. **Data + Fullstack:** у одного связанного `PICASO 3D Designer X C2` имя
   совпадает с `machines`, но у связанной `machines`-записи нет `vendor_id`.
   Сравнение бренда остаётся `same_or_unknown`, а не подтверждённым. Нужен
   явный rule: заполнение vendor либо маркировка связи как неполной.
3. **Fullstack:** три группы одинаковых `(user_id, normalized brand, normalized
   model)` содержат суммарно восемь личных записей. Схема намеренно не запрещает
   повторы; интерфейс и API не должны считать их одним device и не должны
   адресовать `device_state` через `printer_id`.
4. **Data + Devices:** все 85 `user_printers.config_fingerprint` и все 3
   `printers.canonical_config_fingerprint` пусты. Следовательно, сейчас нельзя
   доказать target-binding по fingerprint; значение `declared` также не следует
   выдавать за факт агента. Нужна отдельная поставка заполнения и provenance,
   а не подстановка на клиенте.

## Воспроизводимая read-only проверка

```sql
begin read only;

select tc.table_name, kcu.column_name, ccu.table_name as referenced_table
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  using (constraint_name, constraint_schema)
join information_schema.constraint_column_usage ccu
  using (constraint_name, constraint_schema)
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in ('user_printers', 'device_state', 'device_shares');

select
  (select count(*) from user_printers) as user_printers_total,
  (select count(*) from user_printers where printer_id is null) as without_machine_ref,
  (select count(*) from user_printers up left join users u on u.id = up.user_id
   where u.id is null) as missing_user,
  (select count(*) from device_state ds left join user_printers up on up.id = ds.device_id
   where up.id is null) as missing_device_for_state;

rollback;
```

Запросы не выводят UUID, имена пользователей, credentials или сетевые данные.
Rollback является защитным завершением даже для read-only транзакции.
