# MF-1374 — факт-матрица redaction для API-ключей

Дата проверки: 2026-07-13. Среда: `https://api.dev.3mf.tech`.
Версия факта: `v1`.

---

# MF-1377 — факт denial по scope для read/control

Дата проверки: 2026-07-13. Контур: `apps/api`, публичный API v0.

## Матрица фактов

| Шаг | Ожидание | Факт / HTTP | Источник capability | Redaction / корреляция |
|---|---|---|---|---|
| `GET /v0/printers/:id` с ключом `scopes=[read]` | Чтение разрешено | `200`; возвращены только принтер владельца и нормализованное состояние (`state=ready`) | scope `read` в `requireApiKey`; состояние из `device_state` через `PRINTER_SELECT` | Ответ не содержит credential-полей; `x-request-id` присутствует |
| `POST /v0/printers/:id/commands` с тем же ключом `scopes=[read]` | Управление запрещено до обращения к device/queue | `403 {"error":"missing_scope","required":"control"}`; `device_commands` не создана | scope `control` в `requireApiKey`; capability команды не вызывается | Тело отказа не содержит `key`/`token`; `x-request-id` присутствует |

Тест: `apps/api/src/publicapi/v0.route.test.ts`, `MF-1377: distinguishes allowed read from control scope denial`.
Корреляция HTTP — заголовок `x-request-id`; для разрешённой команды v0 дополнительно возвращается
`correlation_id` из `device_commands`. Секреты и payload в факт не записываются.

## Вывод

Контракт различает отказ именно по отсутствующему scope (`403 missing_scope`) и не смешивает его с
ошибкой владения (`404 not_found`), роли (`403 role_forbidden`) или команды (`403 command_denied`).
Read-only ключ не ставит управляющую операцию в очередь.

Для повторной проверки ожидаемый диагностический признак denial: `403` с
`error=missing_scope` и `required=control`; `401`, `404` и иные варианты `403`
считаются другим классом ошибки, а не подтверждением scope denial.

Цель проверки — подтвердить, что создание и перечисление публичных API-ключей
не раскрывают секрет после контролируемого smoke-запроса. Секрет из ответа
создания не записывался в файл, терминал, комментарий или репозиторий; после
проверки ключ отозван.

## Матрица фактов

| Шаг | Ожидание | Факт / HTTP | Источник capability | Redaction |
|---|---|---|---|---|
| `POST /me/api-keys` с cookie-сессией, `name=mf-1374-redaction-check`, `scopes=[read]` | `201`; секрет выдаётся только один раз | `201`; ответ содержит `id`, `key_prefix`, `name`, `scopes`, `created_at` | `apps/api/src/publicapi/keys.route.ts`, `apps/api/src/publicapi/apiKey.ts`; тест `keys.route.test.ts` | В зафиксированном результате поле `key` удалено до печати (`key_present=false`). Plaintext не сохраняется, в БД пишется `key_hash`. |
| `GET /me/api-keys` той же сессией | Список содержит метаданные, но не секрет | `200`; запись содержит `id`, `key_prefix`, `name`, `scopes`, `revoked_at`, `last_used_at`, `created_at` | `apps/api/src/publicapi/keys.route.ts` (`select` без `key`), `docs/api.public.md` | `secret_like_fields` не содержит `key`, `secret` или `token`; `key_prefix` — только безопасный идентификатор, не credential. |
| `DELETE /me/api-keys/:id` после проверки | Тестовый ключ больше не активен | `204` | `apps/api/src/publicapi/keys.route.ts` | Тестовый credential отозван; значение секрета нигде не фиксировалось. |

## Воспроизведение

```bash
COOKIE=$(cat ~/.autofab-session-dev)
BASE=https://api.dev.3mf.tech

curl -sS -X POST "$BASE/me/api-keys" \
  -H 'content-type: application/json' \
  -H "Cookie: portal_session=$COOKIE" \
  -d '{"name":"mf-1374-redaction-check","scopes":["read"]}'

curl -sS "$BASE/me/api-keys" \
  -H "Cookie: portal_session=$COOKIE"
```

В рабочем запуске значение `key` из первого ответа не выводилось и не
сохранялось. Для проверки списка использовалась проекция только безопасных
полей. Реальный cookie и plaintext ключа в эту документацию не включаются.

## Вывод

Контракт `create/list` подтверждён: `create` возвращает секрет однократно,
`list` возвращает только `key_prefix` и lifecycle-метаданные. Расхождений с
контрактом `docs/api.public.md` не обнаружено. Этот факт относится к текущему
`/me/api-keys` на `api.dev.3mf.tech`; отдельная таблица `user_api_keys` не
подменяет старый рабочий источник `api_keys` для `/v0` без отдельного решения.

---

# MF-1376 — cross-account denial для API v0

Дата проверки: 2026-07-13. Контур: `apps/api`, интеграционный тест `v0.route.test.ts`.
Версия факта: `v1`.

## Матрица фактов

Исполнитель (`actor`) имеет отдельный тестовый аккаунт и ключ со scopes `read,control`; принтер и
команда принадлежат другому тестовому аккаунту (`owner`). Идентификаторы и credentials в evidence
не сохраняются. Перед проверкой owner создал одну безопасную тестовую `pause`-команду в БД; live
устройство и реальная управляющая доставка не затрагивались.

| Шаг | Ожидание | Факт / HTTP | Источник capability | Redaction / корреляция |
|---|---|---|---|---|
| `GET /v0/printers` с actor-ключом | Список не содержит чужой принтер | `200`; `printers=[]` | SQL-фильтр `up.user_id = key.ownerId` или существующий `device_shares` в `v0.route.ts` | В ответе нет чужого `device_id`/`owner_id`; `x-request-id` — единственная корреляция |
| `GET /v0/printers/:id` с actor-ключом | Чужой ресурс не раскрывается | `404 {"error":"not_found"}` | `resolveDeviceRole(id, key.ownerId)` возвращает `null` до чтения состояния | В теле нет чужого UUID или owner UUID; `x-request-id` сохранён отдельно |
| `GET /v0/printers/:id/telemetry` с actor-ключом | Чужая telemetry не читается | `404 {"error":"not_found"}` | Тот же default-deny `resolveDeviceRole` до запроса `device_telemetry` | Нет telemetry, credential или идентификаторов ресурса; корреляция по `x-request-id` |
| `GET /v0/printers/:id/commands/:commandId` с actor-ключом | Чужой статус команды не читается | `404 {"error":"not_found"}` | Проверка роли устройства до выборки `device_commands` | Не раскрываются command/result/correlation; корреляция по `x-request-id` |
| `POST /v0/printers/:id/commands` с actor-ключом | Control чужого ресурса не ставится в очередь | `404 {"error":"not_found"}`; число команд осталось `1` (только owner fixture) | Тот же default-deny role gate до валидации/insert команды | В теле нет owner/device UUID, command или bearer; корреляция по `x-request-id` |

Тест: `apps/api/src/publicapi/v0.route.test.ts`, `MF-1376: изолирует cross-account список, чтение, telemetry и control`.
Все проверки выполняются через `server.inject`; команда owner — БД-фикстура, не live destructive probe.

## Вывод

Cross-account isolation подтверждена для списка, чтения принтера, telemetry, статуса команды и
control: actor получает `200` только с пустым списком и `404 not_found` для чужих адресных ресурсов.
Проверка ownership выполняется до выборки данных и постановки команды в очередь. Наличие только
`read,control` scopes не даёт доступа без account ownership/share; `user_api_keys` не участвует,
источник capability — legacy `api_keys` и `resolveDeviceRole` по `user_printers`/`device_shares`.

## Versioned redaction-проекция

Для повторной проверки сохраняется только allowlist безопасных полей. Ответ
`create` нельзя печатать целиком: plaintext `key` удаляется до любой записи в
лог или артефакт. Минимальная безопасная проверка формы ответа выглядит так:

```bash
# RESP содержит ответ только в памяти текущего shell; значение key не выводится.
printf '%s' "$RESP" | jq '{id, key_prefix, name, scopes, created_at,
  key_present: (has("key"))}'
```

Для `list` допустимы `id`, `key_prefix`, `name`, `scopes`, `revoked_at`,
`last_used_at` и `created_at`; наличие любого поля `key`, `secret` или `token`
является расхождением и должно фиксироваться только как имя поля и HTTP-статус,
без его значения. Это правило делает redaction воспроизводимым и не меняет
одноразовую политику reveal.

---

# Факты доверия устройства: read-only и LAN-only

Дата проверки: 2026-07-13. Карточка: MF-1379. Контур: `connector/device-agent`.

Этот файл описывает только наблюдаемые факты локального полигона. Он не подтверждает
возможность управления, загрузки G-code, relay-доставки или доступность устройства из
интернета.

## Источник и метод

Источник capability — ответ живого Moonraker по локальной сети оператора. Для каждого
доступного устройства выполнены только идемпотентные HTTP GET:

```text
GET /printer/info
GET /printer/objects/list
GET /printer/objects/query?print_stats&extruder&heater_bed
GET /server/webcams/list
```

Аутентификационные данные, токены, полные снимки телеметрии и URL камер не сохранялись.
Корреляция проверки: `MF-1379/read-lan/2026-07-13` (не является секретом и не связывает
пользователя с устройством).

## Подтверждённые read-only capability

| Устройство (LAN) | Наблюдение | Ожидание | Факт |
| --- | --- | --- | --- |
| FLSun T1 (`192.168.1.119:7125`) | `printer/info` | Moonraker доступен локально | HTTP 200, `state=ready`; доступны `print_stats`, `extruder`, `heater_bed`; одна webcam |
| FLSun S1 (`192.168.1.72:7125`) | те же GET | Moonraker доступен локально | HTTP 200, `state=ready`; доступны `print_stats`, `extruder`, `heater_bed`; одна webcam |
| Qidi Q2 (`192.168.1.149:7125`) | те же GET | Moonraker доступен локально | HTTP 200, `state=ready`; доступны `print_stats`, `extruder`, `heater_bed`; найдены chamber-объекты и одна webcam |

Из этих ответов следует только read-only возможность драйвера: `connect`, `capabilities`,
`status` и получение локальных сведений о камере. Это согласуется с
`MoonrakerDriver.capabilities()` и `MoonrakerDriver.status()`.

## Явно не подтверждено

В рамках этой проверки **не выполнялись** `pause`, `resume`, `cancel`, `startPrint`,
`uploadGcode`, произвольный G-code, WebSocket-подписка и relay-команды. Наличие
`print_stats` в read-only ответе — основание показать теоретически поддерживаемые адаптером
команды, но не доказательство права или безопасного выполнения команды на живом принтере.

Камера подтверждена только как запись Moonraker `server.webcams.list`; работоспособность
потока, его публичный доступ и проксирование не проверялись.

## LAN-only и деградация

Проверка выполнялась с Mac в той же локальной сети. Ответы не дают основания считать
`192.168.1.x` серверным или публичным endpoint: адреса — частная LAN, а текущий
`managed-local` контур допускает прямое чтение браузер → Moonraker.

| Endpoint | Шаг | Ожидание | Факт | Честное состояние |
| --- | --- | --- | --- | --- |
| `192.168.1.109:7125` | GET `/printer/info`, connect timeout 1 с | отсутствие read-state при недоступности | HTTP 000, истечение тайм-аута около 1 с | `offline`/нет live-данных; не делать вывод о состоянии печати |
| `192.168.1.145:7125` | тот же GET | отсутствие read-state при недоступности | HTTP 000, истечение тайм-аута около 1 с | `offline`/нет live-данных; не повторять как control |

Деградация означает отсутствие подтверждённого снимка, а не `ready`, не ошибку задания и не
разрешение отправить управляющую команду. Обработка control должна завершаться до обращения
к Moonraker, если нет подтверждённого канала и отдельной авторизации/allow-list.

### Повторная проверка доступности

Дата: 2026-07-13. Выполнены только те же HTTP GET с `connect-timeout=1 с`; ответы
сведены к нормализованным полям, без сохранения конфигурации, URL камеры или других
идентифицирующих данных. FLSun T1 (`.119`) и FLSun S1 (`.72`) ответили HTTP 200:
`printer/info.state=ready`, а `server.webcams.list` содержал по одной записи. Для
FLSun T1 read-снимок `print_stats.state=complete`, температуры экструдера и стола
получены как числовые telemetry-поля; это не является командой и не означает
доступность управления.

Qidi Q2 (`.149:7125`) в этой повторной попытке не установил TCP-соединение за 1 с
(`HTTP 000`, timeout). Это актуальный факт деградации канала: live-состояние Qidi
в этот момент `Unknown`/`offline`, а предыдущий успешный read-only снимок выше не
следует выдавать за текущий. Никаких retry с control, upload или G-code не было.

### Контрольная проверка деградации

Дата: 2026-07-13. До probe Moonraker шлюз `192.168.1.1` ответил HTTP 200, поэтому
это не общий запрет процессу на локальную сеть. FLSun T1 (`.119`) и FLSun S1 (`.72`)
снова ответили `GET /printer/info` с HTTP 200. Qidi Q2 (`.149`), Creality K2 Plus
(`.109`) и Sovol Zero (`.145`) не установили соединение с Moonraker `:7125` за 1 с
(`HTTP 000`, timeout). Для трёх последних устройств зафиксировано только отсутствие
свежего read-снимка; причина недоступности и состояние печати не определялись.
Управляющие запросы, повторы с control, upload и G-code не выполнялись.

### Актуальный read-only probe

Дата: 2026-07-13. Проверка повторена только запросом `GET /printer/info` с
`connect-timeout=1 с` и общим лимитом 2 с. Шлюз `192.168.1.1` ответил HTTP 200;
FLSun T1 (`.119:7125`) и FLSun S1 (`.72:7125`) ответили HTTP 200. Следовательно,
runtime имеет доступ к локальной сети, а успешные ответы подтверждают только
read-only канал Moonraker.

Qidi Q2 (`.149:7125`) и Creality K2 Plus (`.109:4408`) не установили соединение
за лимит 1 с (`HTTP 000`, timeout). Sovol Zero (`.145:7125`) отклонил TCP-соединение
сразу (`HTTP 000`, connection refused). Во всех трёх случаях нет свежего
read-снимка: допустимое отображение — `Unknown`/`offline`, без вывода о причине,
состоянии печати либо доступности control. Управляющие запросы, загрузка и G-code
не выполнялись.

## Вывод

Для трёх перечисленных устройств подтверждён локальный read-only Moonraker. Все control-
capability и выход за LAN остаются `Unknown` до отдельной проверки с явным разрешением на
каждое воздействие.
# Факты capability-контракта device-agent (MF-1380)

Статус: проверено по исходникам и эмулятору Moonraker, без подключения к живому
принтеру и без destructive-команд. Этот документ фиксирует источник данных для
UI-state; он не расширяет публичный контракт выдуманными состояниями.

## Вердикт

Единственный доказанный источник read/control capability в девайс-контуре —
локальный `MoonrakerDriver`, а не карточка принтера, `firmwareClass` или наличие
метода в TypeScript-интерфейсе.

- Read capability строится в `capabilities()` из фактических ответов Moonraker:
  `printer.objects.list` и `server.webcams.list`.
- Control capability строится консервативно: наличие `print_stats` разрешает
  `pause`, `resume`, `cancel`, `start`; затем `CommandHandler` ещё раз сверяет
  команду с этим списком до вызова `driver.*`.
- Read state строится `status()` из `printer.objects.query` по
  `print_stats`, `heater_bed`, `extruder`, `virtual_sdcard`, `chamber` и
  нормализуется в конечный набор `printing | ready | idle | paused | error |
  offline`.
- UI/API должен считать поле отсутствующее или `null` неизвестным, а не
  подменять его состоянием. В частности, прогресс после `complete`/`cancelled`
  намеренно отдаётся `null`.

## Expected / actual

| Поле UI-state | Ожидаемый источник | Фактический путь | Безопасный смысл |
|---|---|---|---|
| `status` | состояние печати Moonraker | `printer.objects.query` → `print_stats.state` → `mapStatus()` | только нормализованное состояние; неизвестный/отсутствующий state → `idle` внутри драйвера, отсутствие heartbeat на сервере → `offline` |
| `nozzleTempC` | текущая температура экструдера | `extruder.temperature`, иначе `null` | `null` = данных нет |
| `bedTempC` | текущая температура стола | `heater_bed.temperature`, иначе `null` | `null` = сенсор/объект недоступен |
| `chamberTempC` | температура камеры | `chamber.temperature`, иначе `null` | `null` не означает 0 или отсутствие камеры |
| `progress` | прогресс текущей печати | `virtual_sdcard.progress` только для `printing`/`paused` | для idle/ready/error/complete/cancelled — `null`, поэтому старый `1` не показывает активную печать |
| `jobId`, `jobFileName` | идентификатор текущего задания | `print_stats.filename`; отдельного job id у базового Moonraker нет | filename — временный proxy-id; не выдавать его как серверный UUID |
| `camera` | наличие настроенной камеры | непустой `server.webcams.list` | capability наличия, не разрешение на публикацию потока |
| `heatedBed` | объект `heater_bed` | `printer.objects.list` содержит `heater_bed` | capability источника, не факт текущего нагрева |
| `heatedChamber` | объект с `chamber` в имени | поиск по `printer.objects.list` | эвристика драйвера; при отсутствии — `false` |
| `multiExtruder` | объект `extruder1` | `printer.objects.list` содержит `extruder1` | только обнаружение второго экструдера |
| control commands | поддержка команд данным конфигом | список `supportedCommands`, затем `CommandHandler` | команда не входит в список → `command_not_supported`, Moonraker не вызывается |

Серверный heartbeat — транспорт, а не новый источник истины: агент пушит
нормализованный `status`, прогресс 0..100 и opaque `metrics`; relay/API сохраняют
их в `device_state`/`device_telemetry`. При отсутствии heartbeat серверный
контур может выставить `offline`; это liveness-факт, не capability принтера.

## Control gate и ошибки

Порядок проверки в `CommandHandler.handle()`:

1. `deviceId`, health (`revoked`/`blocked_config`), монотонный `seq` и
   идемпотентность `commandId`.
2. Подпись/TTL/claims короткого command token: устройство и команда должны
   совпасть с кадром; viewer получает `role_not_allowed`.
3. `driver.capabilities()` и `supportedCommands`.
4. Только после этого вызывается `pause()`/`resume()`/`cancel()`.

Ошибки наружу — стабильные коды (`device_not_owned`, `revoked`,
`blocked_config`, `replay_rejected`, `invalid_token`, `role_not_allowed`,
`command_not_supported`, `command_failed`, `driver_error`). Это expected API
для UI; подробности драйвера допустимы только в `message` ошибки и не являются
состоянием принтера. Ошибка capabilities даёт `internal_error` и не вызывает
Moonraker.

## Redaction и безопасная корреляция

- В heartbeat отправляются только `deviceId`, нормализованный state, числовой
  прогресс и whitelist-метрики `nozzleTempC`, `bedTempC`, `chamberTempC`,
  `jobId`, `jobFileName`.
- `identity.v1` уже редактируется агентом: `deviceId`, версии, модель,
  `configFingerprint`, `configSource`. Fingerprint считается только по
  printer.cfg-relevant секциям; пути, credentials, serial/MAC не входят ни в
  payload, ни в hash input.
- API-key Moonraker не попадает в WS URL или relay; для WS используется
  одноразовый токен, а credential агента передаётся только в hello.
- Командные ACK/error коррелируются по `deviceId + commandId`; `seq` защищает
  от replay. В серверном command envelope допустим отдельный
  `correlation_id` для аудита. Token и payload-секреты в результат UI не
  включаются.
- Повтор того же `commandId` возвращает сохранённый результат без повторного
  вызова Moonraker; новый commandId со старым `seq` отклоняется.

## Граница доказательства

Подтверждено: локальный Moonraker read/control adapter, агентский capability
gate, redacted heartbeat и нормализация состояния. Не подтверждено этой
проверкой: успешный API→relay dispatch в окружении dev, физическая камера,
реальный printer-specific список команд и capability других адаптеров.
Поэтому UI не должен выводить «управление доступно» только по `custom`,
`firmwareClass` или наличию карточки принтера; нужен фактический snapshot и
явный capability response.

Источники: `apps/device-agent/src/driver/printerDriver.ts`,
`apps/device-agent/src/driver/moonraker/moonrakerDriver.ts`,
`apps/device-agent/src/relay/commandHandler.ts`, `protocol.ts`, `identity.ts`,
`apps/api/src/devices/relayInternal.ts` и тесты Moonraker/CommandHandler.

Для MF-1380 итоговый handoff: этот факт относится к контуру `docs + device-agent`;
живые destructive-команды не являются частью доказательства и не выполнялись.

Проверка handoff на актуальном `dev` (2026-07-13): документ сверяется с исходниками
`MoonrakerDriver` и `CommandHandler`; наличие capability без успешного snapshot не
считается доказанным. Это ограничение сохраняется для последующих UI-интеграций.

Для UI это означает: capability следует показывать только после успешного
capability/snapshot-ответа конкретного устройства. Если snapshot устарел или
отсутствует, отображается `Unknown`/`offline` по liveness-контракту; это не
превращается в `control=true` и не является основанием для отправки команды.

---

# MF-1378 — факт rate-limit и recovery публичного API

Дата проверки: 2026-07-13. Контур: API-тест (`apps/api/src/security/rateLimit.test.ts`),
конфигурация по умолчанию в `apps/api/src/security/rateLimit.ts`. Реальный ключ, cookie,
токены и production-запросы не использовались.

| Trigger | Expected | Actual | Correlation / redaction |
|---|---|---|---|
| Повторный запрос с тем же API-key identity в пределах минутного окна | После первого разрешённого запроса следующий сверх лимита получает `429` | `limited=true`, `retryAfterSeconds > 0`; HTTP-адаптер `enforceRateLimit` выставляет `Retry-After` и тело `{"error":"RATE_LIMITED","scope":"public_api","retry_after_seconds":N}` | Тестовый identity `key-redacted`; значение credential отсутствует |
| Тот же identity после истечения окна | Запрос снова разрешён без смены ключа, IP или fingerprint | Через 60 секунд `limited=false` | Корреляция только по scope + opaque test identity; секреты не логируются |

Для `public_api` основной фактор — API-key, по умолчанию 60 запросов/мин
(`RATE_LIMIT_PUBLIC_API_KEY_PER_MIN`); IP и fingerprint — вторичные факторы по 240/мин.
Лимит является временной деградацией, а не отзывом или баном. Recovery-путь безопасен:
клиент прекращает retry до `Retry-After`, затем повторяет тот же запрос с тем же ключом;
обход сменой IP/fingerprint не является частью контракта.

Источник ответа HTTP: `apps/api/src/security/rateLimit.ts::enforceRateLimit`; подключение
к публичному API: `apps/api/src/publicapi/v0.route.ts::requireApiKey`. Ожидаемый контракт
зафиксирован двумя уровнями тестов. Свежий локальный запуск 2026-07-13:

```bash
pnpm --filter @portal/api test -- src/security/rateLimit.test.ts
DATABASE_URL='postgresql:///portal_test?host=/var/run/postgresql&port=5434' \
  pnpm --filter @portal/api test -- src/publicapi/v0.route.test.ts \
  -t 'recovers after the public API rate-limit window'
```

Результат: unit `11/11`, HTTP recovery `1/1`: `200 → 429` (с `Retry-After`) →
`200` после `60_001` мс; в проверке также подтверждено, что ключ не отозван.
В live dev выполнен только безопасный smoke без ключа: `GET /health` → `200`,
`GET /v0/printers` → `401 missing_bearer_token`; production-запросы и токены не
использовались. Полный `v0.route.test.ts` не является частью этого факта: четыре
несвязанных command/audit-теста требуют более поздних миграций локальной БД.

---

# MF-1375 — факт одноразового reveal credential агента

Дата проверки: 2026-07-13. Контур: локальный dev-тест API на dev-схеме Postgres.
Версия факта: `v1`.

Цель проверки — подтвердить, что агентский credential раскрывается только в
первом успешном ответе обмена enroll-кода, а код и credential не попадают в
персистентные факты или HTTP-логи. Значения секрета не выводились, не
сохранялись в файл, карту, комментарий или репозиторий.

## Матрица фактов

| Шаг | Ожидание | Факт / HTTP | Источник capability | Redaction |
|---|---|---|---|---|
| `POST /me/devices/enroll-codes` с dev-сессией | `201`; код выдаётся для одного контролируемого обмена | `201`; plaintext-код используется только в памяти теста | `apps/api/src/devices/enroll.route.ts`, `apps/api/src/devices/enroll.ts`; тест `apps/api/src/devices/enroll.test.ts` | В БД сохраняется только `code_hash`; значение кода не включается в результат факта |
| `POST /devices/agent/enroll` с новым кодом | `201`; credential присутствует только в этом ответе | `201`; credential проверен в памяти по JWT и связан с `agent_id`/`device_id` | `redeemEnrollCode()` и `issueAgentCredential()`; тест `reveals the credential only in the first response...` | Перед любой фиксацией результата credential удалён из проекции; в документации — только `[REDACTED]` |
| Повторный `POST /devices/agent/enroll` с тем же кодом | Повторный reveal невозможен | `401 {"error":"invalid_or_expired_code"}`; новая пара agent/device не создаётся | Атомарный `UPDATE ... WHERE used_at IS NULL ... RETURNING` в `apps/api/src/devices/enroll.ts` | Ответ не содержит credential или enroll-код |
| Проверка `device_enroll_codes` и `device_audit_log` | Секреты отсутствуют в persisted facts | `code_hash`, lifecycle IDs и безопасные audit-метаданные; credential и plaintext-код не найдены | SQL-проверки в API-тесте | JSON-проекции проверяются до завершения теста; логгер пишет только method/url/request_id/status, без body |

## Воспроизведение

```bash
DATABASE_URL='postgres://<dev-role>:<dev-password>@127.0.0.1:5432/<dev-db>' \
JWT_SECRET='test-only' AGENT_JWT_SECRET='test-only-agent' \
pnpm --filter @portal/api test -- src/devices/enroll.test.ts \
  -t 'reveals the credential only in the first response'
```

В рабочем запуске тест создал dev-пользователя с префиксом
`enroll-one-time-reveal`, выполнил один успешный обмен и повторил его тем же
кодом. Динамические UUID, код и credential в факт не переносятся. Для
корреляции используются ключ карточки `MF-1375`, имя теста и endpoint-пара
`/me/devices/enroll-codes` → `/devices/agent/enroll`; это не credential и не
секрет.

## Вывод

Контракт `v1` подтверждён: capability source — backend enroll-контур,
одноразовость обеспечивается транзакцией и `used_at`, redaction выполняется
удалением секретных полей до фиксации результата и отсутствием request body в
API-логах. Повторный reveal не разрешён. Значения credential/enroll-кода в
этом документе отсутствуют.

---

# MF-1381 — redacted correlation для lifecycle и capability events

Дата проверки: 2026-07-13. Контур: `server/API audit` и `device-agent` relay API.
Версия факта: `v1`.

> Исторический audit snapshot старого Fastify relay-контракта. Указанные ниже unversioned
> `/internal/relay/session/*` маршруты удалены и не являются активными API; текущий control-plane —
> typed `/internal/relay/v1/*` с `x-correlation-id` и relay-only service credential.

## Expected / actual

| Событие | Ожидание | Факт | Безопасная проекция |
|---|---|---|---|
| `POST /devices/agent/enroll` → `device.enrolled` | audit связывается с HTTP-запросом | `device_audit_log.meta.request_id` равен ответному `x-request-id` | opaque UUID; `code` и `credential` отсутствуют |
| `POST /me/devices/:id/revoke` → `device.revoked` | audit связывается с действием владельца | `meta.request_id` берётся из нормализованного `request.id` | только UUID, `reason` ограничен маршрутом; секретов нет |
| historical `POST /internal/relay/session/heartbeat` | QA связывала capability snapshot с HTTP-запросом | ответ содержал `request_id`; только принятые устройства обновляли snapshot/telemetry | `device_id`, status, числовые metrics и UUID запроса; credential не отражался |
| historical `POST /internal/relay/session/close` → `device.offline` | системный lifecycle-факт трассировался | `meta.request_id` и `meta.agent_id` | actor оставался `null`; токен relay не писался |
| command queue → `command.queued` | audit связывается с результатом команды | `meta.correlation_id` равен `device_commands.correlation_id`, дополнительно есть `meta.request_id` | оба значения opaque UUID; payload и API-key не пишутся |

`request_id` — UUID HTTP-запроса из `x-request-id` (невалидный вход заменяется
серверным `randomUUID()`); `correlation_id` — UUID команды, созданный БД. Ни один
из них не является credential и не позволяет восстановить секрет. Для UI/QA
достаточно сохранить endpoint, action и соответствующий UUID.

## Redaction rules

- В audit/meta и capability-ответах разрешены только opaque UUID, идентификаторы
  устройств/агентов, action/status, ограниченная причина и whitelisted numeric
  metrics.
- Запрещены `Authorization`, relay token, enroll code, agent credential,
  API-key, URL с query-secret и полные request payload.
- Одноразовый credential по-прежнему возвращается только успешному enroll-ответу;
  добавление correlation не меняет его reveal-политику.

Проверка: `pnpm --filter @portal/api test -- src/devices/enroll.test.ts
src/devices/relayInternal.test.ts` и `pnpm --filter @portal/api build`.
Тесты проверяют equality/формат correlation UUID и отсутствие credential в
persistent audit-проекции.

## MF-1380 — граница доказательства для UI-state

Факт capability читается только из `MoonrakerDriver.capabilities()` и
`CommandHandler`: наличие команды в интерфейсе или модель принтера само по себе
ничего не подтверждает. При отсутствии свежего snapshot UI показывает
`Unknown`/`offline`, не выставляет `control=true` и не отправляет команду.
Изменение опубликовано в `origin/dev`; deployment marker для
`device-agent` в текущем окружении не предоставлен, поэтому этот документ не
выдаёт публикацию за runtime-доказательство.

---

# MF-1375 — факт одноразового reveal credential агента

Дата проверки: 2026-07-13. Контур: локальный dev-тест API на dev-схеме Postgres.
Версия факта: `v1`.

Цель проверки — подтвердить, что агентский credential раскрывается только в
первом успешном ответе обмена enroll-кода, а код и credential не попадают в
персистентные факты или HTTP-логи. Значения секрета не выводились, не
сохранялись в файл, карту, комментарий или репозиторий.

## Матрица фактов

| Шаг | Ожидание | Факт / HTTP | Источник capability | Redaction |
|---|---|---|---|---|
| `POST /me/devices/enroll-codes` с dev-сессией | `201`; код выдаётся для одного контролируемого обмена | `201`; plaintext-код используется только в памяти теста | `apps/api/src/devices/enroll.route.ts`, `apps/api/src/devices/enroll.ts`; тест `apps/api/src/devices/enroll.test.ts` | В БД сохраняется только `code_hash`; значение кода не включается в результат факта |
| `POST /devices/agent/enroll` с новым кодом | `201`; credential присутствует только в этом ответе | `201`; credential проверен в памяти по JWT и связан с `agent_id`/`device_id` | `redeemEnrollCode()` и `issueAgentCredential()`; тест `reveals the credential only in the first response...` | Перед любой фиксацией результата credential удалён из проекции; в документации — только `[REDACTED]` |
| Повторный `POST /devices/agent/enroll` с тем же кодом | Повторный reveal невозможен | `401 {"error":"invalid_or_expired_code"}`; новая пара agent/device не создаётся | Атомарный `UPDATE ... WHERE used_at IS NULL ... RETURNING` в `apps/api/src/devices/enroll.ts` | Ответ не содержит credential или enroll-код |
| Проверка `device_enroll_codes` и `device_audit_log` | Секреты отсутствуют в persisted facts | `code_hash`, lifecycle IDs и безопасные audit-метаданные; credential и plaintext-код не найдены | SQL-проверки в API-тесте | JSON-проекции проверяются до завершения теста; логгер пишет только method/url/request_id/status, без body |

## Воспроизведение

```bash
DATABASE_URL='postgres://<dev-role>:<dev-password>@127.0.0.1:5432/<dev-db>' \\
JWT_SECRET='test-only' AGENT_JWT_SECRET='test-only-agent' \\
pnpm --filter @portal/api test -- src/devices/enroll.test.ts \\
  -t 'reveals the credential only in the first response'
```

В рабочем запуске тест создал dev-пользователя с префиксом
`enroll-one-time-reveal`, выполнил один успешный обмен и повторил его тем же
кодом. Динамические UUID, код и credential в факт не переносятся. Для
корреляции используются ключ карточки `MF-1375`, имя теста и endpoint-пара
`/me/devices/enroll-codes` → `/devices/agent/enroll`; это не credential и не
секрет.

## Вывод

Контракт `v1` подтверждён: capability source — backend enroll-контур,
одноразовость обеспечивается транзакцией и `used_at`, redaction выполняется
удалением секретных полей до фиксации результата и отсутствием request body в
API-логах. Повторный reveal не разрешён. Значения credential/enroll-кода в
этом документе отсутствуют.
