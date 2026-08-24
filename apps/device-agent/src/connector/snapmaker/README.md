# connector/snapmaker — Snapmaker (целевой вендор №1)

## Железо (зафиксировано оператором 2026-07-16)

- **Snapmaker U1** — единственный периодически доступный принтер полигона.
- IP: **192.168.88.82**, принтер в **LAN-режиме** (сеть оператора `192.168.88.0/24`).
- Доступ только с Mac оператора (полигон `printer-polygon`) или будущего парк-воркера;
  из dev-vm LAN недоступен.

## Почему целевой

U1 — принтер, на который нацелена поддержка портала. Прошивка использует **форк Orca** —
в теории поддержку можно сделать «через веб»: серверный коннектор говорит с принтером
по его сетевому API, без какого-либо вмешательства в сам принтер.

## Auth-флоу (наблюдение оператора)

При подключении принтер просит **вбить токен или подтвердить подключение**. Поэтому
коннектор обязан идти через `OperatorConfirmGate` (см. `../common/`): агент пишет в
Telegram через бота «пытаюсь подключиться к Snapmaker U1 192.168.88.82, подтверди /
пришли токен» и ЖДЁТ подтверждения оператора. Полученный токен персистим и
переиспользуем — оператора дёргаем только когда токен протух/отсутствует.

## Факты протокола (живая разведка, MF-1980)

**Вердикт: Moonraker-совместим.** Отдельный `driver/snapmaker/` не нужен — достаточно
`MoonrakerDriver` на `http://<host>:7125` (или через nginx-прокси `:80`).

| Поле | Значение |
|---|---|
| Дата | **2026-07-19** (UTC ~18:51–18:53) |
| Источник | Mac-полигон `printer-polygon`, агент Polygon |
| Как проверено | TG-approval оператора → read-only `curl` к живой U1 (HTTP/JSON + WS Upgrade); без правок прошивки |
| IP (полигон) | `192.168.88.82` (не класть в public project manifest) |

### Порты и поверхности

| Порт | Сервис | Наблюдение |
|---|---|---|
| **7125** | Moonraker (TornadoServer/6.2) | Прямой API; `server.port=7125`, `host=all` |
| **80** | nginx/1.24.0 + **Fluidd** | UI (`title: fluidd`, `manifest.webmanifest` name=fluidd); **проксирует** Moonraker-пути (`/printer/info`, `/server/info`, `/access/info` → 200 JSON) |
| 443 / 4408 / 8080 / 8888 | — | Закрыты на этом экземпляре |

### Moonraker / Klipper identity

- `GET /printer/info` → `state=ready`, **`hostname=lava`**, `software_version=1.5.1.2_20260703125508` (версия Snapmaker, не vanilla `v0.x`), `config_file=/home/lava/printer_data/config/printer.cfg`.
- `GET /server/info` → `moonraker_version=1.5.1`, `api_version_string=1.4.0`, `klippy_connected=true`, `klippy_state=ready`.
- Компоненты (фрагмент): стандартный Moonraker + **`snapmakercloud`**, `octoprint_compat`, `zeroconf`, `authorization`, `webcam`.
- `GET /machine/system_info` → `product_info.machine_type="Snapmaker U1"`, `device_name="U1"`, `firmware_version/software_version=1.5.1`, 4× nozzle 0.4; distro Buildroot 2024.02 / kernel 6.1.99; user `lava`.
- mDNS: `zeroconf.mdns_hostname=U1` (из `GET /server/config`).
- OctoPrint-compat: `GET /api/version` → `text: "OctoPrint (Moonraker 1.5.1)"`.

### JSON-RPC / objects

- `POST /server/jsonrpc` method `printer.info` — OK (тот же payload, что REST).
- `POST /server/jsonrpc` method **`printer.objects.query`** — OK (`configfile`, `print_stats`, `toolhead`, `webhooks`).
- `GET /printer/objects/list` — полный список objects (multi-extruder: `extruder`…`extruder3`, MCU `mcu` + `mcu e0..e3`, множество `gcode_macro SM_*`).
- `GET /printer/objects/query?configfile` — полный `configfile.config` (kinematics **corexy**, `max_physical_extruder_num=4`, bed mesh mesh_max≈267×267, stepper max X/Y/Z ≈ 271 / 335 / 275).
- Live status sample: `print_stats.state=complete`, `webhooks.state=ready`, `toolhead.axis_maximum=[271,335,275,0]`.

### WebSocket

- `ws://<host>:7125/websocket` — **101 Switching Protocols** (curl Upgrade); после open приходят `notify_proc_stat_update` (JSON-RPC notifications).
- HTTP GET `/websocket` без Upgrade → 400 (ожидаемо).
- Oneshot: `GET /access/oneshot_token` → 200, строковый token (стандарт Moonraker; **не логировать/не коммитить**). Подходит для query-string на WS, как ожидает `MoonrakerDriver`.

### Auth (факт с LAN-клиента полигона)

- `GET /access/info` → `login_required=false`, **`trusted=true`**, `default_source=moonraker`.
- В `server/config.authorization`: `force_logins=false`, `enable_api_key=true`, `trusted_clients` включает **`192.0.0.0/8`** (покрывает `192.168.0.0/16`), плюс RFC1918/link-local/localhost.
- С trusted-LAN: read-эндпоинты (`/printer/info`, objects, files list) и даже write-path gcode script отвечают **200 без API-key / без token** (проверено read-only recon + случайный `M115` status-query; токен/X-Api-Key invalid не ломают trusted-доступ).
- **Операторское «confirm on screen / token»** (раздел выше) остаётся продуктовым гейтом `OperatorConfirmGate` для *нашего* коннектора; на этом экземпляре LAN-Moonraker сейчас открыт для trusted clients. Когда `force_logins`/не-trusted — штатный Moonraker path: API-key + oneshot token в query-string.

### Вывод для connector / driver

1. **Совместим с Moonraker** — переиспользовать `../../driver/moonraker/moonrakerDriver.ts`, не писать `driver/snapmaker/`.
2. База HTTP: `:7125` напрямую или `:80` (nginx proxy) — оба отдают идентичный JSON на `/printer/info` / `/server/info`.
3. Идентификация модели: предпочитать `machine/system_info.product_info.machine_type` / `device_name` + `hostname` из `/printer/info` + mDNS `U1`; `software_version` — snapmaker-semver, не klipper-git.
4. Capabilities (из live config/product_info): FDM, 4 toolheads 0.4 mm, bed mesh ~270×270, Z max 275 (степперы 271×335×275 — сверять с marketing 270³ при enroll).

## Что дальше (порядок работ)

1. Разведка API живого U1 с полигона (какие порты/эндпоинты, что за форк Orca,
   есть ли Moonraker-совместимость) — только после TG-подтверждения оператора.
2. Зафиксировать протокол здесь в README (факты + дата + как проверено).
3. `snapmakerConnector.ts` (реализация `PrinterConnector`) + при необходимости
   собственный `PrinterDriver` в `../../driver/snapmaker/` (если Orca-форк не
   совместим с MoonrakerDriver).
4. Эмулятор для тестов (по образцу `src/testing/fakeMoonraker.ts`), чтобы CI жил
   без железа.

## Статус реализации (2026-07-19, MF-1976)

Шаги 3 и 4 сделаны на **предположении** из «почему целевой» (Orca-форк ≈
Moonraker-совместим) — шаг 1 (живая разведка через Polygon) ещё не проведён,
живого доказательства нет. `snapmakerConnector.ts` реализует `PrinterConnector`
поверх `MoonrakerDriver` (свой driver не понадобился, раз несовместимость не
доказана):

- `discover(subnetHint?)` — без `subnetHint` слушает mDNS (`UdpMdnsBrowser`,
  best-effort UDP-запрос `_services._dns-sd._udp.local`, полного DNS-SD
  парсинга нет — источник ответа проверяется HTTP-identity-чеком, а не
  TXT-записями); с `subnetHint` — это `IP` или `IP:port` оператора (ручной
  fallback), не CIDR. Оба пути фильтруют кандидатов через
  `HttpMoonrakerIdentityProbe` (`GET /printer/info`, тот же паттерн, что
  `apps/web/src/park/ipcheck.ts`) — честный wrong-device отказ до показа
  оператору.
- `connect(input)` — identity-check → `OperatorConfirmGate`/сохранённый токен
  (`common/authGate.ts` + `common/tokenStore.ts`) → `MoonrakerDriver.connect()`.
  Если сохранённый токен протух/отозван на принтере, коннектор один раз
  форсированно переспрашивает оператора (`forcePrompt`), не зависает и не
  долбит принтер тихо.
- Эмулятор — расширенный `src/testing/fakeMoonraker.ts` (добавлен
  `GET /printer/info`, конфигурируемый `hostname`/`respondToIdentity`), плюс
  fake `MdnsBrowser` в тестах (реального multicast в CI нет и не будет).
- Тесты (`snapmakerConnector.test.ts`, зелёные на эмуляторе): mDNS-фильтрация +
  permission-denied отдельно от «никого не нашли», ручной IP (успех и
  wrong-device), identity-timeout, auth (gate/saved-token/deny), revoke
  (протухший токен → forced re-prompt → успех, и forced re-prompt тоже
  отклонён оператором).

**Не сделано в этой карточке**: сама разведка живого API (шаг 1) — нужен
LAN-доступ, которого нет из dev-vm; см. sibling-карточку Polygon
(`printer-polygon`, сквад «Локальная разработка», Mac-runtime и LAN-evidence).
Пока она не даст живое подтверждение/опровержение Moonraker-совместимости,
`hostname`-based `model` в `DiscoveredPrinter` — предположение, а не
подтверждённый факт, и поддержка U1 не считается доказанной (только commit +
зелёный эмулятор, без hardware evidence).
