# MF-1315 — сверка `user_printers` и API

Дата проверки: 2026-07-12. Основания: [публичный API](../api.public.md),
[инвентаризация device-схемы](../architecture/device.tables.md), [вердикт MF-1076 в
domain model](../epics/domain.model.md#user_api_keys--config_fingerprint-mf-1076-вердикт-data-к-mf-1075-п4--вердикт-схема-прогнана-вперёд-назад),
миграции `20260710310000_device_fleet_foundation.sql` и
`20260711290000_user_api_keys_config_fingerprint.sql`.

## MF-1316: контракт `user_api_keys`

Публичные API-ключи принадлежат `user_id` и идентифицируются наружу только
через `key_prefix`. Секрет хранится исключительно как SHA-256 `key_hash`;
plaintext не является полем модели ответа. Контракт жизненного цикла включает
`scopes`, `created_at`, `expires_at`, `revoked_at`, `updated_at`,
`last_used_at` и `revoked_reason`; активные ключи с истёкшим сроком исключаются
из выборок. Каноническая схема зафиксирована миграцией
`20260712230100_user_api_keys_public_contract.sql`.

## Сводная таблица соответствий

| Факт схемы / реализации | Что обещает `docs/api.public.md` | Результат |
|---|---|---|
| Каноническая запись экземпляра — `user_printers`; `user_printers.user_id → users.id`, `printer_id → machines.id` (`NOT VALID`), `device_state/device_telemetry/device_commands.device_id → user_printers.id` | Принтер описан как запись `user_printers`; API возвращает экземпляр и его состояние | Совпадает на уровне источника данных и кардинальности. API не возвращает `user_id`/`printer_id`, поэтому каталог `machines` из публичного ответа не виден. |
| Один владелец через `user_printers.user_id`; `device_shares` — 0..N, unique `(device_id,user_id)`, роли `owner/operator/viewer/guest` | Владелец получает `owner`, расшаренный пользователь — роль; `owner/operator` могут управлять, `viewer/guest` только читать; чужое устройство скрывается как `404` | Совпадает. Но заголовок раздела `GET /v0/printers` («Список принтеров владельца ключа») сужает фактический контракт: код также возвращает расшаренные устройства. |
| `device_state` — 0..1 на принтер; `device_telemetry` — 0..N; `device_commands` — 0..N | `/v0/printers/:id` читает состояние, telemetry читает историю, commands ставит очередь и читает статус | Совпадает по кардинальности и маршрутам. `queued` подтверждает постановку в SQL-очередь, но не доставку — это корректно оговорено в доке. |
| `user_printers.firmware_class` допустим `klipper|octoprint|bambu|prusa|creality`; `capabilities` — jsonb; `last_seen_at` — nullable | Ответ называет `firmware_class` значением `connector_type`, отдаёт `last_seen_at`; `capabilities` не описан | Частичное совпадение: `connector_type` — API-переименование, `capabilities` намеренно теряется в сериализации. Если capability-контракт нужен внешнему интегратору, его надо добавить отдельной карточкой/изменением API-доки и кода. |
| MF-1076 добавляет `user_printers.config_fingerprint`, `config_fingerprint_source` (`agent|declared`), `config_fingerprint_stock_declared`, `config_fingerprint_updated_at`; на каталожной модели — `printers.canonical_config_fingerprint` | В разделе slice-cache упомянут `config_fingerprint` как часть отпечатка и account scope | Разрыв: публичный printer API не возвращает fingerprint и не имеет endpoint его чтения/изменения. Это согласуется с MF-1076 («расчёт/заполнение — вне миграции»), но API-дока должна явно сказать, что fingerprint — внутренний будущий атрибут, а не поле `/v0/printers`. |
| MF-1076 создаёт `user_api_keys` со scope `slicing|printer|public_api`, `key_hash/secret_enc` и rotation chain | Публичный API документирует ключи `/me/api-keys` со scope `read|control`, а реализация `/v0` читает старую таблицу `api_keys` | Существенный разрыв схемы↔API: `user_api_keys` MF-1076 пока не подключена к `/v0`; `api_keys` остаётся рабочим источником ключей. Документация должна явно пометить MF-1076 как подготовительную, не заменившую `api_keys` модель. |
| В `user_printers` `link_source` допускает `connector|popular|search|manual|agent` и дополнительно `ip` после managed-local миграции | Публичный `/v0` не принимает `link_source` и не возвращает его | Совпадает как граница публичного API, но связь с источником экземпляра недоступна внешнему клиенту. Для `/me/printers` это отдельный cookie-контракт, которого в `api.public.md` нет. |

## Ошибки и фильтры

- Фильтр списка реализован как `user_printers.user_id = key.owner_id OR EXISTS device_shares`; фильтр конкретного принтера использует тот же owner/share resolver. Это соответствует `404` для недоступного устройства и роли `owner/operator/viewer/guest`.
- `read`/`control` — scopes старой `api_keys`, не scopes `user_api_keys` MF-1076. Нельзя считать таблицы взаимозаменяемыми до отдельной миграции и переноса читающего кода.
- Для команды код фактически возвращает `403 command_denied` также для явно запрещённых `format/delete`; это отражено в таблице ошибок. `unknown_command` и `invalid_script` имеют allow-list/max length, как в документации.
- `GET /v0/printers/:id/commands/:commandId` присутствует в коде; проверка статуса должна дополнительно подтверждать принадлежность команды указанному устройству и владельцу/шару. В текущем чтении маршрута это следует проверить отдельным API-тестом, поскольку в `docs/api.public.md` правило описано только общим `404`.

## Итог и владельцы разрывов

1. Исправить текст `GET /v0/printers`: перечислять «свои и расшаренные» принтеры — владелец документа API.
2. Добавить в `docs/api.public.md` явную оговорку: MF-1076 `user_api_keys` и fingerprint — подготовительная схема; текущий `/v0` использует `api_keys`, а fingerprint не является полем публичного ответа — владелец MF-1076/Back.
3. Не добавлять `capabilities`, `user_id`, `printer_id` и fingerprint в публичный ответ без отдельного решения о расширении контракта и тестов; сейчас это реальные поля БД, но не поля `/v0` — владелец API.

Свежесть оснований на момент проверки:

```text
docs/api.public.md                              5d2eb8d | 2026-07-12 | Test
docs/architecture/device.tables.md              5d2eb8d | 2026-07-12 | Test
docs/epics/domain.model.md                      5d2eb8d | 2026-07-12 | Test
apps/api/db/migrations/20260710310000_...       5d2eb8d | 2026-07-12 | Test
apps/api/db/migrations/20260711290000_...       5d2eb8d | 2026-07-12 | Test
```
