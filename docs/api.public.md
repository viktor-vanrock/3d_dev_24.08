# Публичный API управления принтером (v0)

**Карточка MF-888** (stage 2 эпика [epics/printer.support.md](epics/printer.support.md)/[MF-879](https://tasks.3mf.tech)),
спутник [architecture/printer.server.md §2.9](architecture/printer.server.md). Владелец — Devices/Gateway.

Это дока для юзера, который пишет **СВОЮ** интеграцию/коннектор под свой принтер — работает даже без
нашей прошивки, поверх любого Moonraker/родного API принтера (`docs/epics/printer.support.md`
§«Сделай сам»). Кнопка «Сделать самому» на карточке неподдерживаемого принтера ведёт сюда.

## Модель v0

Три сущности:
- **Принтер** — запись `user_printers` (заявленный юзером принтер: вручную, через Prusa Connect, или
  агентом).
- **Состояние** — горячий снэпшот `device_state`: `state` (`printing`/`ready`/`idle`/`paused`/`error`/
  `offline`), `progress` (0..100), `metrics` (протокол-специфичный jsonb: `nozzle_temp_c`/`bed_temp_c`/
  `chamber_temp_c`/... — набор полей зависит от прошивки, не гарантирован полностью).
- **Команда** — запись очереди `device_commands`: `gcode`/`start`/`pause`/`stop`.

**Что не работает в v0:** команда через `POST /v0/printers/:id/commands` сначала проходит fail-closed
policy: managed-local и непривязанный экземпляр отклоняются, а cloud-команда принимается только для
enrolled online agent с объявленной capability. Принятая команда получает статус `queued`, но
**доставка на устройство ждёт push-канал agent-relay → устройство** (MF-886 спайк data-plane,
MF-887 enroll-контур — на момент написания ещё не готовы).
Это явная граница, не баг: как только канал появится, очередь начнёт разбираться без смены контракта
этого API. `files` (аплоад g-code) и вебхуки/события — вне v0 (см. `printer.server.md §2.9`, v2).

## Аутентификация

Два разных механизма, не путать:

1. **Управление ключами** (`/me/api-keys/*`) — под обычной портальной сессией (cookie), из личного
   кабинета/вебом. Здесь юзер создаёт/смотрит/отзывает ключи для СВОЕЙ интеграции.
2. **Сам публичный API** (`/v0/*`) — Bearer API-ключ, без сессии/cookie. Так его дёргает внешний
   скрипт/сервер юзера, а не браузер.

### Жизненный цикл ключа: создать, перечислить, отозвать, ротировать

```bash
curl -X POST https://api.3mf.tech/me/api-keys \
  -H 'content-type: application/json' \
  --cookie "portal_session=$SESSION" \
  -d '{"name": "мой принтер-бот", "scopes": ["read", "control"]}'
```

```json
{
  "id": "5b8b8f5e-...",
  "key": "mf_pub_EXAMPLE_ONLY_7yQeN...",
  "key_prefix": "mf_pub_EXAMPLE",
  "name": "мой принтер-бот",
  "scopes": ["read", "control"],
  "created_at": "2026-07-11T10:00:00.000Z"
}
```

`key` показывается **один раз** — портал хранит только его sha256, восстановить нельзя (потерял —
отзывай и создавай новый). `scopes`:

| Scope | Даёт |
|---|---|
| `read` | `GET /v0/printers*` — состояние, телеметрия |
| `control` | `POST /v0/printers/:id/commands` — постановка команды в очередь |

При пустом или отсутствующем `scopes` создаётся ключ только с `read`. Допустимы только `read` и
`control`; неизвестное значение даёт `400 {"error":"invalid scopes","allowed":["read","control"]}`.
Имя ключа обрезается до 128 символов; на владельца действует максимум 20 активных ключей.

`GET /me/api-keys` — список своих ключей: секрет никогда не возвращается, только метаданные
`id`, `name`, `key_prefix`, scopes, `revoked_at`, `last_used_at` и `created_at`.

`DELETE /me/api-keys/:id` — отзыв (ответ `204`; ключ сразу перестаёт проходить `/v0/*`). Повторный
отзыв или чужой/невалидный UUID отвечает `404 not_found`. Истёкший по серверному сроку ключ также
сразу считается недействительным для `/v0/*` и получает тот же `401 invalid_api_key`; срок не
возвращается и не задаётся через публичный HTTP-контракт.

`POST /me/api-keys/:id/rotate` атомарно отзывает активный ключ и выпускает новый с теми же scopes.
Новый секрет (`key`) показывается один раз; старый перестаёт работать в рамках той же транзакции.
Ответ `201` имеет ту же форму, что и создание. Для уже отозванного ключа ответ —
`409 {"error":"already_revoked"}`; неизвестный или чужой ключ — `404 not_found`. Опциональное
тело `{ "name": "новое имя" }` меняет имя нового ключа.

Минимальный smoke-поток (все вызовы `/me/api-keys` требуют cookie-сессию):

```bash
# 1. create — сохранить key только в менеджере секретов
curl -sS -X POST https://api.3mf.tech/me/api-keys \
  -H 'content-type: application/json' --cookie "portal_session=$SESSION" \
  -d '{"name":"ci-printer","scopes":["read","control"]}'
# 2. list — key здесь отсутствует
curl -sS https://api.3mf.tech/me/api-keys --cookie "portal_session=$SESSION"
# 3. revoke — после этого Bearer получает 401 invalid_api_key
curl -i -X DELETE https://api.3mf.tech/me/api-keys/$KEY_ID --cookie "portal_session=$SESSION"
# 4. rotate — для активного ключа: старый отозван, новый key показывается один раз
curl -sS -X POST https://api.3mf.tech/me/api-keys/$KEY_ID/rotate \
  -H 'content-type: application/json' --cookie "portal_session=$SESSION" \
  -d '{"name":"ci-printer-rotated"}'
```

В примерах `$SESSION`, `$KEY_ID` и `$API_KEY` — placeholders, реальные cookie и ключи в документацию
или логи не помещаются.

### Использовать ключ

```bash
curl https://api.3mf.tech/v0/printers \
  -H "Authorization: Bearer $API_KEY"
```

Для публичного API действует rate limit: 60 запросов в минуту на ключ по умолчанию
(`RATE_LIMIT_PUBLIC_API_KEY_PER_MIN`). Дополнительно применяются лимиты IP и fingerprint — по 240
запросов в минуту (`RATE_LIMIT_PUBLIC_API_IP_PER_MIN` и
`RATE_LIMIT_PUBLIC_API_FINGERPRINT_PER_MIN`). При превышении сервер отвечает `429` с заголовком
`Retry-After` (секунды до конца окна) и телом
`{"error":"RATE_LIMITED","scope":"public_api","retry_after_seconds":N}`. Это временная
деградация, а не отзыв или бан ключа: после окна запросы снова разрешаются.

### Граница моделей ключей и scopes

Не смешивайте два контракта. В этом v0 публичные маршруты используют legacy-таблицу `api_keys`
и только два scope: `read` и `control` (основание: [epics/domain.model.md](epics/domain.model.md) §`user_api_keys`
и [architecture/printer.server.md §2.9](architecture/printer.server.md)). Модель `user_api_keys`
для будущего разрезания прав задаёт scopes `slicing`, `printer`, `public_api`; это отдельная
граница, а не синоним legacy scopes, и она не добавляется в v0 без отдельного изменения контракта.

Правило проверки — default-deny: неизвестный scope, пустой scope или scope не из набора конкретного
маршрута означает отказ. Секрет ключа (`key`/secret), `key_hash` и `secret_enc` нельзя возвращать
в ответах, писать в логи или включать в примеры. Единственное исключение — поле `key` в ответе
создания: оно показывается один раз и не является частью хранимого/логируемого представления;
список возвращает только `key_prefix`.

#### Матрица маршрутов и отказов

| Маршрут | Аутентификация | Требуемый scope | Отказ |
|---|---|---|---|
| `POST /me/api-keys` | портальная сессия | — | `401 unauthorized`; неизвестный scope в теле — `400` |
| `GET /me/api-keys` | портальная сессия | — | `401 unauthorized` |
| `DELETE /me/api-keys/:id` | портальная сессия владельца | — | `401 unauthorized` или `404 not_found` |
| `POST /me/api-keys/:id/rotate` | портальная сессия владельца | — | `401 unauthorized`, `404 not_found` или `409 already_revoked` |
| `GET /v0/printers` | Bearer legacy `api_keys` | `read` | `401 missing_bearer_token`/`invalid_api_key`; нет `read` — `403 missing_scope` |
| `GET /v0/printers/:id` | Bearer legacy `api_keys` | `read` | те же `401`/`403`; чужой или неизвестный принтер — `404 not_found` |
| `GET /v0/printers/:id/telemetry` | Bearer legacy `api_keys` | `read` | те же `401`/`403`; чужой или неизвестный принтер — `404 not_found` |
| `POST /v0/printers/:id/commands` | Bearer legacy `api_keys` | `control` | те же `401`; нет `control` — `403 missing_scope`; роль `viewer`/`guest` — `403 role_forbidden`; чужой принтер — `404 not_found` |
| `GET /v0/printers/:id/commands/:commandId` | Bearer legacy `api_keys` | `read` | те же `401`/`403`; чужая или неизвестная команда — `404 not_found` |

`403` не используется для подтверждения существования чужого принтера или команды: такие случаи
маскируются как `404 not_found`. Ошибки scope не должны раскрывать данные ресурса.

## Доступ к конкретному принтеру

Ключ видит только принтеры своего владельца:
- принтер, который сам юзер завёл (`user_printers.user_id`) — роль `owner`;
- принтер, расшаренный ему (`device_shares`) — роль `owner`/`operator`/`viewer`/`guest`.

`control` (команды) требует роли `owner` или `operator` — `viewer`/`guest` только читают, попытка
команды отвечает `403 role_forbidden`. Принтер не твой и не расшарен тебе → `404` (не `403` — не
подтверждаем даже факт существования чужого принтера).

### Безопасный test job (MF-1534)

Для QA-стенда используется отдельная boundary `POST /v0/printers/:id/test-job/commands`. Запрос обязан
содержать `{ "safe_test_job": true }`; без этой явной маркировки сервер отвечает
`403 {"error":"safe_test_job_required"}`. Разрешены только `query`, `pause` и `resume`. Команды
`start`/`stop` получают `403 command_denied`, неизвестная команда — `400 unknown_command`; ни один
отказ не ставит команду в очередь.

`query` возвращает только нормализованные `state`, `progress` и `job_id` в поле `result` — без
метрик, payload, API-ключа или других секретов. Для `pause`/`resume` обязателен обычный
`Idempotency-Key`; повтор с тем же ключом не создаёт второй эффект. `X-Request-Id` выдаётся
в заголовке ответа и допускает только opaque UUID. Маркер `safe_test_job` используется только
для допуска запроса и никогда не возвращается в ответе или в нормализованном результате.

Пример проверки статуса:

```json
{
  "device_id": "<printer-id>",
  "command": "query",
  "result": { "state": "ready", "progress": null, "job_id": null }
}
```

Для `pause`/`resume` ответ `202` содержит только идентификаторы команды, устройство, команду,
статус `queued` и время создания. `query` не ставится в очередь. Любая команда, которая не
прошла marker, allow-list или обычную device-capability policy, завершается отказом до записи
в `device_commands`.

Канонические отказа boundary: `{ "error": "safe_test_job_required" }` для запроса без marker,
`{ "error": "command_denied" }` для `start`/`stop` и `{ "error": "unknown_command" }` для
команды вне известного набора. Эти ответы не содержат идентификатор ключа или исходное тело
запроса.

## Enroll агента: одноразовый код и credentials

Enroll — отдельный от `mf_pub_` API-ключей контур для долгоживущего агента. Код создаёт авторизованный
пользователь, а агент обменивает его ровно один раз на credentials устройства. В URL, логах и ответах
не передаются секреты кроме самого кода в момент его выдачи и bearer-токена в ответе на успешный обмен.

### Создать код

`POST /me/devices/enroll-codes` требует обычную портальную сессию (cookie). Тело запроса пустое либо:

```json
{ "device_name": "Ender в мастерской" }
```

Ответ `201` (поле `code` показывается пользователю/оператору один раз):

```json
{
  "code": "enr_7K4M-2Q9P-6X8R",
  "expires_at": "2026-07-11T10:15:00.000Z",
  "device_name": "Ender в мастерской"
}
```

TTL кода — не более 15 минут (`expires_at` серверный, клиент не может его продлить). В базе хранится
только SHA-256-хэш кода; plaintext не сохраняется. Код нельзя получить повторно через `GET` или из
истории. Для нового подключения или после истечения TTL создайте новый код — это и есть ротация кода.

### Обменять код на credentials

`POST /devices/agent/enroll` — публичный endpoint агента, без cookie. Тело:

```json
{ "code": "enr_7K4M-2Q9P-6X8R", "agent_id": "optional-client-uuid" }
```

Ответ `201`:

```json
{
  "agent_id": "…",
  "device_id": "…",
  "credential_type": "bearer",
  "access_token": "agent_eyJ…",
  "expires_at": "2027-07-11T10:00:00.000Z"
}
```

`access_token` показывается только в этом ответе и затем используется агентом как
`Authorization: Bearer …` для relay/API agent. Credentials индивидуальны для устройства и не
переиспользуются между устройствами. Повторная отправка того же кода, в том числе параллельная,
всегда отклоняется: сервер атомарно помечает код использованным до выпуска credentials. Успешный
обмен не продлевает TTL уже истёкшего кода и не создаёт вторую пару credentials.

### Ротация и отзыв

`POST /me/devices/enroll-codes` создаёт новый код, но не отзывает credentials уже подключённого
устройства. Для отзыва используется `POST /me/devices/:id/revoke`; после отзыва текущий токен
перестаёт приниматься при следующем подключении/проверке. Повторное подключение требует нового
enroll-кода и выпуска новых credentials. Отзыв одного `device_id` не затрагивает остальные устройства
пользователя.

Ошибки enroll имеют стабильную JSON-форму и не раскрывают, существует ли код:

```json
{ "error": { "code": "enroll_code_expired", "message": "Enroll code is expired" } }
```

| HTTP | `error.code` | Случай |
|---|---|---|
| `400` | `invalid_enroll_request` | отсутствует/неверно сформирован `code` или тело запроса |
| `401` | `invalid_enroll_code` | код не найден (включая уже использованный код) |
| `410` | `enroll_code_expired` | код найден, но его TTL истёк |
| `401` | `agent_credentials_invalid` | credentials отсутствуют, истекли или отозваны |
| `409` | `agent_already_enrolled` | агент пытается повторно привязать уже зарегистрированный `agent_id` |
| `429` | `RATE_LIMITED` | превышен лимит; вернуть `Retry-After` |

Тестовые ожидания: создать код и проверить TTL ≤15 минут; успешный обмен возвращает credentials без
кода в ответе; второй обмен тем же кодом (последовательный и конкурентный) не выпускает credentials;
истёкший код даёт `410/enroll_code_expired`; случайный/искажённый код даёт
`401/invalid_enroll_code`; отзыв отклоняет дальнейшую аутентификацию токеном; новый код после отзыва
позволяет выпустить новые credentials. В тестовых логах и snapshot-ответах секреты должны быть
заменены на `[REDACTED]`.

### Канонические примеры исходов

Успешный обмен (секрет присутствует только в этом ответе):

```json
{
  "agent_id": "agent-uuid",
  "device_id": "device-uuid",
  "credential_type": "bearer",
  "access_token": "[REDACTED]",
  "expires_at": "2027-07-11T10:00:00.000Z"
}
```

Истёкший код:

```json
{ "error": { "code": "enroll_code_expired", "message": "Enroll code is expired" } }
```

Повторное использование (включая конкурентный повтор) и случайный/искажённый код имеют один
безопасный ответ: сервер не раскрывает, существовал ли код и был ли он уже использован.

```json
{ "error": { "code": "invalid_enroll_code", "message": "Invalid enroll code" } }
```

Неверное тело запроса, например отсутствие `code`, получает детерминированную ошибку валидации:

```json
{ "error": { "code": "invalid_enroll_request", "message": "Invalid enroll request" } }
```

## Rate limit

60 запросов/мин на ключ (`RATE_LIMIT_PUBLIC_API_KEY_PER_MIN`, деградация — `429` + `Retry-After`, не
бан). IP/fingerprint — вторичные факторы того же лимитера (`security/rateLimit.ts`), для серверных
интеграций малополезны, лимит по самому ключу — основной контроль. Контракт не меняется для
очереди облачного слайсинга MF-1078: её `slice_create` — отдельный scope того же rate-limit слоя,
а per-account cache остаётся изолированным по `account_id`.

Для маршрутов, прошедших rate-limit gate, включая ответ `429`, сервер публикует только эти
служебные заголовки:

| Заголовок | Формат | Смысл |
|---|---|---|
| `X-RateLimit-Limit` | целое число | лимит выбранного фактора в текущем окне |
| `X-RateLimit-Remaining` | целое число `≥ 0` | доступные запросы до следующего отказа |
| `X-RateLimit-Reset` | Unix time в секундах | окончание текущего окна |
| `X-Request-Id` | opaque UUID | correlation ID запроса для поддержки и логов |

`X-Request-Id` берётся из безопасного `request.id`: входной `X-Request-Id` принимается только если
это UUID, иначе сервер создаёт новый. Он не дублируется в JSON-ответе. На `429` дополнительно
возвращается `Retry-After`; это отдельный retry hint, а не четвёртое metadata-поле.

В rate-limit metadata нет `Authorization`, API-ключей, cookie, токенов, IP, fingerprint, payload,
внутренних `retryAfterSeconds`/`slowdownMs` или иных неизвестных полей. `MF-1222` сохраняет тот же
барьер: секрет нового ключа показывается один раз только в ответе создания/ротации и не попадает в
rate-limit ответ, заголовки или correlation ID.

## Контракт slice-cache: account scope (v1)

Результат слайсинга идентифицируется отпечатком входов: `slice_key` вычисляется из хэша модели
(канонический 3MF), масштаба, `profile_id`/материального профиля, версии движка и
`config_fingerprint` принтера. Этот отпечаток **всегда** хранится и ищется вместе с
`account_id` (в API это владелец ключа/сессии); одинаковый fingerprint у аккаунтов A и B — это
две разные записи кэша. Отсутствие account scope — ошибка запроса, а не режим глобального кэша.

Запрос A никогда не может прочитать или перезаписать результат B. Прямого endpoint по одному
`slice_key` нет: выдача результата разрешена только владельцу соответствующей account-scoped
джобы и выдаёт presigned URL, созданный для этого запроса. Обработчик дополнительно проверяет
приватный ключ результата по шаблону `protected/slices/{account_id}/{slice_key}.gcode` до
подписания или потоковой выдачи. Чужой `slice_key`, job, storage-key или presigned URL отвечает
`404 not_found` (без подтверждения существования); сервер не возвращает чужие `gcode_s3_key`,
account_id или внутренние метрики. Это же правило действует при совпадении всех частей fingerprint.

Запись cache-hit идемпотентна внутри `(account_id, slice_key, user_id, model_id)`. Уникальность
этого составного ключа не позволяет повторной записи одного аккаунта затронуть запись другого:
`account_id` является обязательной частью и индекса, и внешнего ключа на cache entry.

Матрица проверки:

| Сценарий | Ожидание |
|---|---|
| A и B отправили одинаковый fingerprint | разные `(account_id, slice_key)`, ключи не коллидируют |
| B читает результат A | `404 not_found`, без URL/метаданных |
| B повторно пишет fingerprint A | создаётся/обновляется только запись B; запись A не меняется |
| A получает свой готовый результат | presigned URL только для A; ответ редактирован (`redacted`) |

На dev проверять через `https://api.dev.3mf.tech` с двумя отдельными аккаунтами и не сохранять
токены/URL в логи или тестовые snapshots.

## Эндпоинты

### `GET /printers`

Публичный каталог канонических карточек принтеров; авторизация не требуется. Поддерживает фасеты
`q`, `brand`, `status`, `kinematics`, `type`, `currency`, `price_min`, `price_max`, `fits_x`,
`fits_y`, `fits_z`, `ams`, `laser`, `cnc`, `enclosed`, `hardened`, `moonraker`, `lan_mode`,
`auto_leveling` и сортировки `recommended`, `new`, `price_asc`, `price_desc`, `build_volume`.
`limit` ограничен текущим общим лимитом каталога, `cursor` — непрозрачный курсор из предыдущего
ответа; `offset` не является частью контракта.

```json
{
  "printers": [],
  "has_more": false,
  "next_cursor": null,
  "gap_counts": {}
}
```

Когда `has_more=true`, `next_cursor` всегда непуст. Некорректный, устаревший или несовместимый
курсор безопасно возвращает первую страницу с теми же фильтрами и HTTP 200; последняя страница
возвращает `has_more=false` и `next_cursor=null`. Данные читаются из канонической таблицы
`printers`, а не из локальных fixture-файлов.

### `GET /v0/printers`

Список принтеров владельца ключа.

```json
{
  "printers": [
    {
      "id": "…", "brand": "Creality", "model": "Ender-3 V3 KE",
      "connector_type": "klipper", "state": "printing", "progress": 42.5,
      "job_id": null, "metrics": { "nozzle_temp_c": 210 },
      "state_updated_at": "2026-07-11T09:58:00.000Z",
      "last_seen_at": "2026-07-11T09:58:00.000Z"
    }
  ]
}
```

### `GET /v0/printers/:id`

Один принтер, та же форма объекта, что и элемент списка выше. `404`, если не твой/не расшарен.

### `GET /v0/printers/:id/telemetry?limit=100&since=2026-07-11T00:00:00Z`

История `device_telemetry`, новые записи первыми. `limit` ≤ 500 (дефолт 100). `since` — ISO 8601,
опционально (только записи новее).

```json
{ "telemetry": [{ "recorded_at": "…", "status": "printing", "progress": 42.5, "metrics": {} }] }
```

### `POST /v0/printers/:id/commands`

Требует scope `control` и роль `owner`/`operator`. Тело:

```json
{ "command": "gcode", "script": "G28" }
```

Заголовок `Idempotency-Key` обязателен (непустая строка до 128 символов). Сервер сохраняет
envelope команды с `device_scope = :id` и `actor_scope = owner_id` ключа. Повтор того же ключа
для того же устройства и актёра возвращает исходный результат и не создаёт вторую команду;
другой `command` с этим ключом получает `409 idempotency_conflict`.

`command` — один из `gcode` (обязателен `script`, ≤4000 символов), `start` (опционален
`file_name`), `pause`, `stop`. Ответ `202`:

```json
{ "id": "…", "device_id": "…", "command": "gcode", "status": "queued", "created_at": "…" }
```

### `GET /v0/printers/:id/commands/:commandId`

Статус ранее поставленной команды (`queued`/`acked`/`rejected`, `result` — заполняется, когда
появится доставка на устройство).

## Коды ошибок

| Код | Когда |
|---|---|
| `401 missing_bearer_token` / `invalid_api_key` | нет единственного корректного заголовка `Authorization: Bearer <key>` (в том числе при нескольких заголовках или пробеле внутри ключа) либо ключ неверный, отозван или истёк |
| `403 missing_scope` | ключ без нужного scope (`control` на команду с `read`-only ключом) |
| `403 role_forbidden` | доступ есть, но роль `viewer`/`guest` — команды не для тебя |
| `404 not_found` | принтер/команда не существует ИЛИ не твоя |
| `400 unknown_command` / `invalid_script` | невалидное тело команды |
| `400 invalid_idempotency_key` | отсутствует или невалиден `Idempotency-Key` |
| `403 command_denied` | команда вне явного allow-list либо не совпадают device/actor scope |
| `403 LAN_FORBIDDEN` | managed-local или непривязанный к enrolled agent принтер нельзя управлять из cloud API |
| `403 CAPABILITY_UNSUPPORTED` | enrolled agent не объявил запрошенную capability |
| `409 DEVICE_OFFLINE` | enrolled agent или устройство offline/stale |
| `409 idempotency_conflict` | ключ повторно использован с другой командой |
| `429 RATE_LIMITED` | превышен лимит, смотри `Retry-After` |

## QA evidence и безопасный dev-smoke (MF-1391)

Lifecycle ключа и denial связаны с общей матрицей в [trust.md § Evidence-поток trust journey v1](product/trust.md).
В отчёте используются только placeholders `$SESSION`, `$API_KEY`, `$KEY_ID`; реальные cookie,
Bearer и credentials не записываются. Указываются expected/actual, redacted command, artifact
link или SHA256, verdict и commit/MF linkage. Перед smoke: `git fetch origin dev; git rebase origin/dev`.
Docs-only поток не требует web deployment marker.

## Альтернативный путь — свой агент вместо REST-поллинга

Если интеграция уже держит постоянное соединение с принтером (свой демон на Raspberry Pi/сервере в
локалке) и хочет получать команды пушем, а не поллингом `commands/:id`, посмотри `enroll`-контур
(`POST /me/devices/enroll-codes` → `POST /devices/agent/enroll`, `docs/architecture/printer.server.md
§2`) — тот же контракт, что использует наш собственный `apps/device-agent`. Это отдельная от `mf_pub_`
API-ключей авторизация: gateway использует индивидуальный mTLS certificate, а wire contract берётся из
`@portal/contracts/device-protocol/v1`. Relay принимает только обязательный `protocol_version:"v1"`;
это путь для долгоживущего gateway-процесса, а не для разовых вызовов из скрипта/бэкенда.
