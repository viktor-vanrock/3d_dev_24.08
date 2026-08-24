# Серверный слой управления принтерами — архитектура

**Спутник эпика MF-879** ([../epics/printer.support.md](../epics/printer.support.md)). Здесь — весь
backend: от «достучаться до принтера за NAT» до «ферма 20+ под одним дашбордом». Проектирование, не код.

## 0. Что говорит рынок (определяет коннекторы)

Топ-4 = **90%** мировых продаж (sub-$2500, 2025-2026): **Bambu Lab #1 (37%)**, Creality, Anycubic,
Elegoo. Prusa — премиум. FLSun/Voron/Sovol/Qidi — ниши. **Вывод: нельзя строить только под Klipper** —
крупнейший бренд (Bambu) проприетарный. `managed` обязан быть мульти-протокольным; `custom` (наша
прошивка) — только для перепрошиваемых на Klipper (Creality-часть, Voron, FLSun, Sovol и т.п.), Bambu
custom НЕ поставить (закрытый bootloader) — его только `managed` через реверс-протокол.

## 1. 🔴 Ключевая проблема: принтер за NAT/CGNAT

Сервер НЕ может подключиться к принтеру «по IP» — он в локальной сети юзера за NAT. «Введи IP» работает
ТОЛЬКО когда браузер юзера в той же сети (прямой запрос браузер→Moonraker, минуя наш сервер). Для
удалённого управления из облака — три пути, и они задают под-уровни `managed`:

| Под-уровень | Как сервер достаёт принтер | Пример |
|---|---|---|
| **managed-local** | браузер юзера ↔ принтер напрямую (та же LAN), сервер только UI | любой Moonraker в домашней сети |
| **managed-cloud** | сервер ↔ облако вендора ↔ принтер | Bambu Cloud (MQTT), Prusa Connect |
| **managed-bridge** | лёгкий НАШ агент-мост в сети юзера ↔ туннель к нам (без кастом-прошивки) | Klipper-принтер без облака |
| **custom** | полный наш агент+визуал на принтере ↔ туннель | наша прошивка |

Итог: **любое облачное управление требует либо облака вендора, либо нашего агента/моста в сети юзера.**
«Просто по IP» = локальный режим. Это фундамент — заложить в UX «добавить принтер» честно.

## 2. Слои backend (снизу вверх)

### 2.1 Ingest / Connectivity (fan-in — самый тяжёлый)
- **Agent-relay** (`apps/relay`): наш агент/мост держит **outbound raw WSS-туннель** (работает за
  NAT, исходящее) к отдельному compiled NestJS data-plane. Relay завершает TLS 1.3 mTLS, привязывает
  индивидуальный gateway certificate к identity до hello, хранит sessions in-memory и не ходит в DB.
- **Cloud-poller** (managed-cloud): воркеры, что говорят с облаками вендоров (Bambu Cloud MQTT, Prusa
  Connect REST) от имени юзера (его токен вендора) — fan-out по внешним облакам, свои рейт-лимиты.
- Разделение: relay держит СОЕДИНЕНИЯ (постоянные), poller — ОПРОС внешних API (периодический).

### 2.2 Connector-adapters (нормализация протоколов — плагинная)
Единый внутренний контракт `PrinterDriver`: `getState() · sendGcode() · uploadFile() · start/pause/stop ·
subscribeTelemetry() · camera()`. Реализации:
- **MoonrakerAdapter** — HTTP + WS JSON-RPC (Klipper: FLSun, Voron, Creality-K1/Ender-V3 с Moonraker,
  наш custom). Якорный.
- **BambuAdapter** — MQTT (статус/команды) + FTP (файлы), LAN Dev-mode или через Bambu Cloud. #1 охват.
- **PrusaAdapter** — PrusaLink (локально) / Prusa Connect (облако), REST.
- **OctoPrintAdapter** — REST+WS (универсальный мост для старых/DIY, кто уже на OctoPrint).
- **DuetAdapter** (RRF) — ниша, позже.
Новый бренд = новый адаптер, ядро не трогается. Адаптеры — воркеры за relay/poller.

#### 2.2.1. Инвентарь реализованного контура (MF-1202)

Ниже — не целевая схема, а проверяемая инвентаризация исходников на `dev`. `Unknown` означает,
что в читаемых server/adapter/device-agent исходниках нет реализации или наблюдаемого источника;
это не следует трактовать как «поддерживается». Пути и символы — точки, откуда следует каждый
факт.

| Режим | Читаемое состояние | Действия/канал | Источник и наблюдаемый статус |
|---|---|---|---|
| `managed-local` | Браузер напрямую вызывает `GET http://<lan_endpoint>/printer/info`; в нормализованный live-снимок попадает только `result.state`, который UI сводит к `ready` или `offline`. Server-side state, telemetry, temperatures, job и capabilities: **Unknown** | `POST /me/printers/:id/commands` существует, но `resolveOperatingState()` для `managed-local` выставляет все `command_capabilities=false`, поэтому команда завершается `command_denied/capability_unconfirmed`; server-side upload/camera/proxy: **Unknown** | `apps/api/src/profile/activation.ts` (`POST /me/printers`, `GET /me/printers/:id/live`, `POST /me/printers/:id/commands`); `apps/api/src/profile/contract.ts::resolveConnectionMode/resolveOperatingState`; `apps/web/src/park/ipcheck.ts`, `livesource.ts`. Вызов из браузера — не доказательство server-to-LAN reachability |
| `managed-cloud` | Bambu/Prusa cloud state: **Unknown**; текущий API operating-контракт этот режим не представляет | Bambu MQTT+FTP, Prusa REST control, cloud telemetry/files/camera: **Unknown** | `apps/api/src/profile/contract.ts::CONNECTION_MODES` содержит только `list`, `managed-local`, `managed-bridge`; `apps/api/src/printers/prusaConnect.route.ts` и `prusaConnect.sync.ts` подключают/синхронизируют аккаунт и список принтеров, но не реализуют printer control; `BambuAdapter`/cloud-poller в server code не найден |
| `managed-bridge` | Canonical v1 heartbeat принимает `printing/ready/idle/paused/error/offline`, `progress_percent`, bounded `metrics`, `identity`, `sequence`; API читает snapshot через owner/public projections | API создаёт durable `device_commands`; Nest relay claim/lease/result flow доставляет per-device ordered `command`, отделяет transport ACK от terminal result и fence-ит stale process. API staging + immutable transfer metadata/presigned range source запускают resumable file stream; camera остаётся отдельным будущим контуром | `packages/contracts/device-protocol/v1`; `packages/contracts/http/relay-internal.v1.openapi.json`; `apps/api/src/modules/{devices,relayInternal}`; `apps/relay/src/{commands,transfers,gateway}`; `apps/device-agent/src/relay` |
| `custom` | Отдельного server-side режима нет: `link_source='agent'` разрешается в `managed-bridge`; доступное через agent heartbeat состояние такое же, но custom visual/firmware identity не доказаны | Agent Moonraker driver имеет capabilities/status, pause/resume/cancel, uploadGcode/startPrint, camera и status push; relay/public delivery этих действий и custom firmware visual: **Unknown** | `apps/api/src/profile/contract.ts::resolveConnectionMode`; `apps/device-agent/src/driver/printerDriver.ts`; `apps/device-agent/src/driver/moonraker/moonrakerDriver.ts`; `apps/device-agent/src/relay/client.ts`, `commandHandler.ts`, `fileTransfer.ts`; `apps/device-agent/src/main.ts` связывает локальные callbacks, но server-side custom classification отсутствует |

#### 2.2.2. Server/device capability matrix

| Capability | Source of truth | `managed-local` | `managed-cloud` | `managed-bridge` | `custom` |
|---|---|---:|---:|---:|---:|
| Current state read | `GET /me/printers/:id/live`, `GET /v0/printers/:id`, direct LAN `GET /printer/info` | Direct LAN state only (`ready`/`offline`); server mirror: **Unknown** | **Unknown** | API snapshot: yes; source is relay heartbeat | Same agent heartbeat, but mode classification: **Unknown** |
| Telemetry push/history | Relay v1 session heartbeat writes authorized snapshots through API control-plane; public/profile routes read projections | **Unknown** | **Unknown** | Yes for devices in the API-authorized session set | Same agent path, custom distinction: **Unknown** |
| Pause/resume/cancel/start | `/me/devices/:id/commands`, `/me/printers/:id/commands`, `/v0/.../commands`, agent `CommandHandler` | Route exists but all capabilities denied; no LAN command path | **Unknown** | Durable ordered claim, ACK and terminal result: yes for canonical command capabilities | Agent local driver execution: yes; custom mode classification: **Unknown** |
| Arbitrary G-code | API allowlist + `payload.script` in `/v0`/legacy route | **Unknown** (no local server action) | **Unknown** | API queue accepts `gcode`, but agent `CommandFrame` allowlist is only pause/resume/cancel; end-to-end: **Unknown** | Agent `PrinterDriver` has no `sendGcode`; **Unknown** |
| File upload | API-owned `device_transfers`, relay v1 metadata/source/progress/result, `file_start/file_chunk`, Moonraker `/server/files/upload` | **Unknown** | **Unknown** | Immutable range-stream, resume and terminal persistence: yes | Agent `FileTransferHandler` + Moonraker upload: yes; custom classification: **Unknown** |
| Camera | Agent/driver `camera()` | **Unknown** | **Unknown** | Agent can return a local stream URL, relay/public stream: **Unknown** | Local driver camera: yes; relay/public stream: **Unknown** |
| Enroll/revoke | `/me/devices/enroll-codes`, `/devices/agent/enroll`, `/me/devices/:id/revoke`, relay mTLS authorize/revalidate | Not required | Connector auth: **Unknown** | Individual certificate identity; revoke closes an active session fail-closed within five seconds | Same gateway identity path; custom classification: **Unknown** |

The matrix deliberately keeps protocol capability separate from server reachability: a driver method,
WS frame or API queue entry is not proof of a connected end-to-end path. The source-backed gaps are
`managed-cloud`, the local server mirror, API→relay command/file dispatch, bridge terminal result
propagation and camera streaming. `custom` is also not a persisted server classification; it must not
be inferred from `firmware_class` alone.

#### 2.2.3. Фактический handoff `managed-local` (MF-1188)

Путь v1: браузер делает direct GET к нормализованному `lan_endpoint` Moonraker → API сохраняет
owner-scoped запись `user_printers` (`link_source='ip'`) → UI открывает `/printer/:id` и читает live
state тем же браузерным запросом. Сервер не ходит в LAN, не проксирует этот трафик и не принимает
через этот путь команды или upload. Это отдельный контур от `managed-bridge`/`custom`, где
`device_state` приходит через relay/agent. Внешняя физическая e2e-приёмка этого пути — владелец
доказательства MF-1187; её нельзя подменять ссылкой на реализацию MF-1188.

#### 2.2.4. Политика cloud-команд (MF-1142)

`POST /me/printers/:id/commands`, `/me/devices/:deviceId/commands` и
`POST /v0/printers/:id/commands` используют один fail-closed policy-gate из
`apps/api/src/printers/command-policy.ts`. `managed-local` и непривязанный к агенту экземпляр
никогда не становятся server-to-LAN каналом: ответ — `403 {"error":"LAN_FORBIDDEN"}`.
Команда cloud-контура принимается только для enrolled `agent` с актуальным heartbeat и online
состоянием; иначе возвращается `409 {"error":"DEVICE_OFFLINE"}`. Capability сверяется с живым
`user_printers.capabilities`; незаявленная команда получает `403 {"error":"CAPABILITY_UNSUPPORTED"}`.
Единый OpenAPI-контракт находится в `packages/contracts/printer-api/openapi.yaml`.

#### 2.2.5. HTTPS mixed content и managed-local: Fleet-факт и решение (MF-1835/MF-1841)

Доказанный факт (MF-1835, Front, Playwright/headless Chromium на `https://dev.3mf.tech`,
`c66c043f`): `fetch(http://<lan_endpoint>/printer/info)` из HTTPS-страницы —
active mixed content, браузер блокирует запрос ДО сети независимо от состояния LAN-устройства.
Причина на уровне спецификации браузера, а не бага реализации: mixed-content gate проверяет,
что клиент запроса — secure context (страница на HTTPS), а целевой URL —
"potentially trustworthy"; произвольный LAN IP (`192.168.x.x` и т.п.) в этот список не входит.
Council MF-1195/MF-1687 не поймал ограничение, потому что e2e Front гонял портал на
`http://127.0.0.1:5173` — тот же LAN-запрос там не mixed content.

Технический разбор трёх вариантов, вынесенных на council MF-1841:

1. **Service-worker-прокси — отклонено.** FetchEvent-обработчик исполняется в контексте того же
   origin (`https://dev.3mf.tech`), что и страница; mixed-content gate проверяет security context
   клиента запроса, а не то, какой JS-контекст инициировал fetch. Service worker не может
   обойти сетевой уровень браузера — это не архитектурный выбор, а тот же самый браузерный
   security boundary. Front (MF-1835) оценил вариант нежизнеспособным; Fleet подтверждает.
2. **Локальный helper на loopback — технически жизнеспособно, рекомендация Fleet.**
   `127.0.0.1`/`localhost` — единственное исключение в списке "potentially trustworthy origin"
   независимо от схемы; `https://dev.3mf.tech` может сделать `fetch(http://127.0.0.1:<port>/...)`
   без mixed-content блокировки. Локальный helper-процесс на машине пользователя слушает
   loopback, принимает такой запрос от браузера и сам делает исходящий plain-HTTP запрос к
   реальному LAN IP принтера — это уже не браузерный fetch и не подпадает под mixed-content
   policy вообще (та ограничивает только запросы из browsing context). Требование к реализации:
   современный Chrome постепенно вводит Private Network Access preflight для запросов с
   публичной/secure страницы в приватную сеть (включая часть loopback-путей) — helper обязан
   отвечать на preflight заголовком `Access-Control-Allow-Private-Network: true`; это требование
   реализации, не блокер жизнеспособности. Это отдельный, минимальный компонент — НЕ то же самое,
   что `managed-bridge` agent: без enroll, без relay-туннеля, без command capability, только
   read-only loopback-прокси поверх уже существующего browser-probe. Владение — Devices/UltraPrint.
3. **Пересмотр через `managed-bridge` — технически возможно, отклонено для этой карточки.**
   Bridge-агент уже существует (`apps/device-agent`, relay-туннель), но перевод ВСЕХ
   managed-local принтеров на него убирает zero-install "введи IP" уровень целиком (см. §1) и
   требует нового factual gate и пересмотра capability/readiness-матрицы (§2.2.2) и command-policy
   (§2.2.4) с Back — несоразмерно масштабу этого технического блокера.

**Решение Fleet:** managed-local остаётся read-only browser→LAN явно; единственное изменение —
браузер обращается к loopback-адресу локального helper вместо LAN IP напрямую, helper делает
реальный LAN-запрос. Инварианты MF-1195/MF-1687 не меняются: сервер по-прежнему не становится
server-to-LAN каналом, `command_capabilities=false` и `403 LAN_FORBIDDEN` (§2.2.4) остаются без
изменений — Back-политика не требует правок. Новый факт для Design/UX (не предписывается Fleet):
нужно различимое состояние «helper не обнаружен/не запущен» отдельно от текущего
`direct timeout/error` (реальный сбой LAN-пробы через работающий helper) — то же правило
`printer.surface-states.md` §3 «добавление потребует отдельного факта Fleet и решения Design-UX»,
это и есть тот факт. Copy и приёмку нового состояния Fleet не формулирует.

### 2.3 Enroll & Identity
Одноразовый код (MF-390) → индивидуальные креды/сертификат на устройство (mTLS предпочтительно), отзыв
НА устройство (не на парк), ротация. Устройство — недоверенная среда (MF-423..425): канал outbound-only,
креды не покидают устройство, per-user изоляция парка.

#### Эксплуатационный контракт enroll (MF-1214)

Текущий v1-dev-контракт реализован в `apps/api/src/devices/enroll*.ts` и воспроизводится без
production-секретов:

| Этап | Контракт | Результат |
|---|---|---|
| Выдать код | авторизованный `POST /me/devices/enroll-codes` | `201`, код показывается один раз; `expires_at` через 15 минут или раньше; install-команда |
| Обменять код | `POST /devices/agent/enroll {code, agent_version?}` | `201`, создаются agent/device/audit-строки и выдаётся credential |
| Подключиться | relay передаёт credential в `session/open` | `401 {"error":"invalid_token"}` для неверного, неизвестного или отозванного credential; состояние credential наружу не раскрывается |
| Отозвать | владелец `POST /me/devices/:deviceId/revoke` | `200 {ok:true}`, только credential этого устройства; повтор — `409 already_revoked` |
| Восстановить | владелец `POST /me/devices/enroll-codes {device_id}` после отзыва, затем агент `POST /devices/agent/enroll` | `201`, новый agent/credential, прежний `user_printers.id`; чужое, активное или не-agent устройство — `404 not_found` |

Код хранится только как SHA-256 (`device_enroll_codes.code_hash`), в plaintext он не пишется в БД и
не должен попадать в логи. Редимпшн атомарен: `UPDATE ... WHERE used_at IS NULL AND expires_at > now()`
в транзакции с созданием устройства. Поэтому свежий код даёт success, истёкший или уже использованный
код даёт детерминированный `401 {"error":"invalid_or_expired_code"}`; конкурентная вторая попытка
получает тот же ответ. Ошибка подписи credential откатывает транзакцию и не сжигает код.

Выданный credential — JWT типа `agent`, отдельный `AGENT_JWT_SECRET`, TTL 400 дней (около 13 месяцев),
не секрет пользователя и не session-cookie. Relay/API проверяют `typ`, подпись и срок, затем свежим
запросом к `agents.revoked_at` проверяют отзыв. Отзыв помечает только конкретный `agent`, переводит
устройство в `offline` и пишется в audit log; уже открытый WS не рвётся мгновенно, запрет действует
на следующем connect/reconnect и не инициирует команду или печать. Для неверного, неизвестного и
отозванного credential `session/open` возвращает один и тот же `401 {"error":"invalid_token"}`:
состояние credential и устройства не становится oracle. Ротация: отозвать устройство, затем
создать новый enroll-код и повторить обмен; старый credential не переиспользуется. Recovery-код связывается с прежним
`device_id`, поэтому транзакция заменяет только `user_printers.agent_id`, сохраняет карточку
устройства и пишет `device.recovered`; новая запись принтера не создаётся.

Dev-проверка (без production-секретов): задать тестовые `JWT_SECRET` и `AGENT_JWT_SECRET`, прогнать
`apps/api/src/devices/enroll.test.ts` и `revoke.test.ts` через штатный test-скрипт API. Минимальные
сценарии — fresh code → `201` и проверяемый credential; вручную сдвинуть `expires_at` в прошлое →
`401 invalid_or_expired_code`; повторить тот же код → тот же `401`; revoke → следующий `session/open`
`401 {"error":"invalid_token"}`. Нормализованный отказ и повторный connect без возврата устройства
в live-состояние проверяются в [`apps/api/src/devices/relayInternal.ts`](../../apps/api/src/devices/relayInternal.ts)
и [`apps/api/src/devices/relayInternal.test.ts`](../../apps/api/src/devices/relayInternal.test.ts).
Никогда не печатать credential/code в диагностике или комментариях — проверять только статус, claims
без токена и наличие записей audit.

#### 2.3.1 Фактический контракт WSS для недоверенного устройства (MF-1146)

Реализация: SHA `1afb410e021cbbbfc54dbfed9d26fafef865b4b2` (Back, 12.07.2026);
разделение health-порта и mTLS-listener: SHA `3753075e1c01e045c6b81f771109a0e0182794b8` (Back,
12.07.2026). Контракт распространяется на `apps/api`, `apps/device-agent` и `apps/relay`.

- Endpoint/event: `WSS /relay/ws`; relay первым кадром отправляет canonical v1
  `hello_challenge {nonce}`, агент отвечает
  `hello {protocol_version:"v1", nonce, agent_version, capabilities}`. Nonce одноразовый и привязан
  к TLS-соединению; bearer token в hello отсутствует.
- Транспорт: TLS 1.3 с обязательным client certificate, подписанным CA из `RELAY_TLS_CA_FILE`;
  `RELAY_TLS_CERT_FILE`, `RELAY_TLS_KEY_FILE` и `RELAY_TLS_CA_FILE` обязательны при старте. Агент
  использует тот же CA и client keypair. Сертификат вне CA отвергается на TLS handshake.
- Scope: relay синхронно вызывает `POST /internal/relay/v1/sessions/authorize` с certificate identity
  и fingerprint; API возвращает current device set, session generation и authorization revision.
  Каждый device-bearing heartbeat/command/file/result frame проверяется по этому set.
- Close/error semantics: невалидная аутентификация — `4001 auth_failed`, heartbeat timeout —
  `4002 heartbeat_timeout`, неизвестный `deviceId` — `device_not_owned`; отклонённый кадр не
  изменяет состояние устройства.
- Развёртывание: gateway WSS использует `RELAY_GATEWAY_HOST/PORT`, loopback observability — отдельные
  `RELAY_OBSERVABILITY_HOST/PORT`; L4 proxy передаёт только TLS gateway traffic.
- `protocol_version:"v1"` обязателен. Versionless или другая версия отклоняется без N-1 fallback;
  unknown/oversized fields fail closed по closed schema/limits. Единственный authority —
  `packages/contracts/device-protocol/v1`; relay и device-agent используют его generated types,
  runtime validators и shared valid/invalid fixtures.

Контрактные и real TLS tests находятся в `packages/contracts/device-protocol/v1`,
`apps/relay/src/gateway`, `apps/device-agent/src/relay` и `apps/api/src/modules/relayInternal`.
Физическая приёмка требует dev relay health `200`, реальный agent с выданным client certificate,
отказ сертификата вне CA и отказ replay/чужого `device_id`; локальные fakefleet и unit-тесты этот
гейт не заменяют.

#### 2.3.2 Безопасное восстановление device-agent (MF-1180)

Агент является необязательным сетевым мостом, а не частью контура печати. Поэтому ошибка его
конфигурации, отозванный credential или недоступный Moonraker не должны приводить к удалённой
команде, изменению `printer.cfg` или попытке отката прошивки/образа ОС. При любой неопределённости
агент выбирает fail-closed для relay-команд; локальный Klipper UI сохраняет управление печатью.

Публичный endpoint `GET http://127.0.0.1:9797/health` использует версионированную схему
`health.v1` и возвращает только следующие статусы:

| Статус | HTTP | Relay и удалённые команды | Локальная печать | Действие оператора |
|---|---:|---|---|---|
| `healthy` | 200 | разрешены по обычному контракту | не затрагивается | штатная эксплуатация |
| `degraded` | 200 | разрешены только если credential/config валидны; недоступный relay не блокирует локальный контур | не затрагивается | проверить сеть/Moonraker и журнал |
| `blocked_config` | 503 | запрещены, credential/config не ретраятся вслепую | не затрагивается | восстановить safe-релиз или повторить enroll |
| `revoked` | 503 | запрещены; отозванный credential не переиспользуется | не затрагивается | отозвать/подтвердить отзыв и получить новый enroll-код |

Состояние `degraded` не означает, что сервер может выполнять команды: каждый relay-кадр всё равно
проходит проверку действующего credential, scope и capability. Смена статуса не вызывает команду
Moonraker и не меняет его настройки. Схема аддитивна: новые статусы нельзя добавлять без обновления
контракта и операционного runbook.

Восстановление выполняется только операторским контрактом установки:

1. `apps/device-agent/deploy/rollback.sh` от root останавливает только `portal.device-agent`,
   переключает `current` на сохранённый `previous` safe-релиз и запускает сервис снова;
2. если safe-релиза нет, оператор повторно устанавливает проверенный архив; агент сам не меняет
   firmware, `printer.cfg`, OS image и не выполняет flashing;
3. при отзыве credential оператор сначала отзывает устройство в портале, затем получает новый
   enroll-код; при удалении `apps/device-agent/deploy/uninstall.sh` очищает unit, релизы,
   конфигурацию и локальные credentials. При отсутствии root или доступа к хосту нужна физическая
   интервенция владельца принтера.

Источники контракта и lineage: recovery-gates и runbook — commit
`5e72dcbeb0926e08c834b1277ff77f4ec49bceff` (Front, 12.07.2026), исправление lifecycle-статусов —
`4452c4c1ac754a86c4fe9a1e8265a3117e1a1932` (Data, 12.07.2026), gate публикации —
`18d8de5b9da3a1111aada518dc11d47f57b5ab4b` (Front, 12.07.2026). Проверяемый сценарий rollback
зафиксирован в [`docs/verification/mf-1241-device-agent-rollback.md`](../verification/mf-1241-device-agent-rollback.md).

### 2.4 Telemetry pipeline (поток от парка)
Температуры/прогресс/статус потоком. При 100k×частый тик — БД не переварит:
- **Агрегация на входе** (relay/adapter схлопывает тики), **горячее** состояние в памяти процесса («сейчас») +
  **холодное** (TimescaleDB/Postgres-партиции или VictoriaMetrics, история). Backpressure: дропаем/
  прореживаем при перегрузе, не копим бесконечно. Деление горячего/холодного — обязательно (MF-442).

### 2.5 Command & Queue
Старт/пауза/стоп/G-code/макросы. Устройство офлайнится ПОСТОЯННО → **идемпотентные команды**, очередь
переживает реконнект, состояние сверяется, а не предполагается, подтверждение доставки. Durable PostgreSQL-очередь
per-device. Приоритет команд (стоп > старт).

#### 2.5.1 Реализованные границы команды (MF-1151/MF-1482)

Активный Nest v1 path разделён на три независимые границы:

1. `apps/api/src/devices/shares.route.ts` (`POST /me/devices/:deviceId/commands`) проверяет owner/operator,
   создаёт `device_commands`, выдаёт короткий token и возвращает `202`; набор — только `pause/resume/cancel`.
   `apps/api/src/profile/activation.ts` и `apps/api/src/publicapi/v0.route.ts` имеют более широкий queue-only
   allowlist (`gcode/start/pause/stop` и др.), но это лишь запись в БД и не доказательство доставки.
2. `apps/api/src/modules/relayInternal` предоставляет canonical typed
   `POST /internal/relay/v1/commands/claim`, lease heartbeat и `PUT .../result`. PostgreSQL claim
   выдаётся только live authorized session и защищён owner/token/generation fencing.
3. `apps/device-agent/src/relay/client.ts` принимает `command`, `apps/device-agent/src/relay/commandHandler.ts`
   проверяет token/role/capability/seq и вызывает Moonraker driver; `apps/device-agent/src/relay/protocol.ts`
   ограничивает принимаемый command frame до `pause/resume/cancel`.

Nest `CommandDeliveryService` связывает claim с current fenced WSS session, сохраняет
`delivered`/`acknowledged` lease states и принимает только explicit `executed|failed` terminal result.
Device-agent persistent terminal ledger возвращает тот же outcome для duplicate command после restart.

Для файлов граница аналогична: `/me/devices/:deviceId/transfers` создаёт metadata, relay имеет
`SendFileFrame`/`file_start`/`file_chunk`, а `apps/device-agent/src/relay/fileTransfer.ts` принимает чанки,
пишет spool, проверяет размер/SHA-256, вызывает Moonraker `uploadGcodeStream` и при флаге запускает печать.
API staging сохраняет immutable object tuple; relay запрашивает short-lived version-bound HTTPS URL,
стримит bounded ranges и сохраняет agent-confirmed offset/terminal result. Видео/камера отдельного
relay/public endpoint не имеет — **Unknown**.

Нормализованная read-проекция результата команды опубликована отдельно в
[`docs/contracts/relay-command-result.v1.md`](../contracts/relay-command-result.v1.md): она
аддитивна к raw-схеме и owner-scoped `GET /me/printers/:id/commands/:commandId`. `acked` не
подменяется `executed`; последний возможен только после authoritative post-command state.
Проверки источника: shared contract fixtures, relay unit/TLS/compiled smoke, API real-Postgres
claim/transfer suites и device-agent command/file tests. `command_ack` подтверждает только transport
receipt; terminal status требует `command_result`.

### 2.6 File & Slice
v1: юзер шлёт готовый G-code/3MF → валидация → доставка на принтер (uploadFile адаптера). **Серверный
(облачный) слайсинг — MVP в v1** (пересмотр скоупа оператором 2026-07-11, MF-1075; было v2) —
`apps/mesh` + профили MF-34/408..413: модель+профиль→G-code на сервере, потом на принтер, кэш
только per-account. Источник истины по версии — `../product/roadmap.md` § «Пересмотр скоупа v1 —
2026-07-11» и `../epics/v1.device.cloud.md`. Крупные файлы — S3 + presigned, не через
контроль-плоскость.

#### 2.6.1 Атомарный контракт handoff нарезанного G-code в printer job (MF-1143/MF-1220)

Три эндпоинта образуют один сквозной, проверенный тестами control-plane контракт producer(mesh)
→ API → printer job; контракт формализован в
[`packages/contracts/printer-api/openapi.yaml`](../../packages/contracts/printer-api/openapi.yaml):

1. `POST /models/{id}/slice` (`apps/api/src/models/slicing.route.ts`) ставит job слайсинга,
   принимает подписываемое `slice_trust` evidence (MF-1698 `slice-trust.v1`:
   account/device/profile/slice_key/config_fingerprint) и идемпотентен по
   `(account_id, slice_key, model_id)`.
2. `GET /slice-jobs/{jobId}` отдаёт готовый результат только с полным versioned evidence и
   storage-key в account-scoped префиксе (`protected/slices/{account_id}/...`); объект,
   истёкший/удалённый из storage, отдаёт `error: gcode_missing`, а не 500 или прошлый URL —
   S3-key/URL никогда не публикуется между аккаунтами.
3. `POST /me/printers/{id}/commands` c `command: gcode` (`apps/api/src/profile/activation.ts`)
   принимает только opaque `slice_id`; перед постановкой команды в очередь проверяет — в этом
   порядке — account ownership слайса (`slice_not_found` иначе, тот же код для «не существует»
   и «чужой»), `status=ready` (`slice_not_ready`), полноту/версию `slice_trust` evidence
   (`slice_untrusted`), совпадение `device_id` слайса с целевым принтером
   (`slice_target_mismatch`) и равенство живого `config_fingerprint` цели зафиксированному в
   evidence (`fingerprint_mismatch`). Повтор с тем же `Idempotency-Key` возвращает уже созданную
   команду, не заводя вторую запись `device_commands`.

Test vectors (success / чужой account / fingerprint mismatch / expired object / duplicate
request) — `apps/api/src/profile/activation.test.ts` (`describe("POST /me/printers/:id/commands
— gcode slice handoff (MF-1220)")`) и `apps/api/src/models/slicing.route.test.ts`
(`describe("GET /slice-jobs/:jobId — expired storage object (MF-1143, integration)")`).

Это контракт «разрешить/поставить job», не доказательство физической доставки G-code на
устройство — тот отдельный, помеченный **Unknown** e2e-gap `API → relay → agent → Moonraker`
из §2.5.1 этим не закрывается.

### 2.7 Camera / Stream
Вебка (MJPEG/WebRTC) через туннель/облако — тяжёлый трафик, ОТДЕЛЬНЫЙ путь (не через основной API):
проксирование/relay потока, ленивая подписка (стрим только когда смотрят), деградация качества.

### 2.8 Fleet management (парк/ферма)
Модель парка юзера: устройства, группы, статусы, **алерты поверх телеметрии** (MF-442: залип/ошибка/
закончился филамент), дашборд фермы (мелкое/крупное производство 20+ — цель проекта). Ролевой доступ
(оператор фермы vs сотрудник).

### 2.9 Public API + Community («сделай сам»)
- **Публичный API управления** (та же нормализованная модель наружу): `state/command/telemetry/files` с
  ключами/скоупами/rate-limit — юзер пишет свою интеграцию под свой принтер (даже без нашей прошивки).
- **Community-firmware реестр**: CRUD ссылок на GitVerse-репо сообщества (model/автор/git_url/verified),
  выдача списком на карточке модели. Модерация/бейдж доверия — позже.
- **Firmware registry**: support_level, firmware_repo (GitVerse-URL, даёт оператор), firmware_ready/public.

## 3. Разделение плоскостей (важно для масштаба)
- **Control-plane** (`apps/api`, NestJS): аккаунты, парк, каталог, команды-инициация, публичный API,
  реестры — обычная HTTP-нагрузка, существующий стек.
- **Data-plane** (`apps/relay`, отдельный NestJS process + adapters): постоянные raw WSS/mTLS туннели,
  telemetry, command/file delivery. Он не встроен в API process и не читает Portal DB.

## 4. Этапы (ложатся на версии)
- **v1 (пилот):** enroll + agent-relay (MF-26/390..392) + **MoonrakerAdapter** + custom-визуал на 1-2
  моделях (Ender-3 V3 KE / FLSun V400); managed-local (браузер↔Moonraker); серверный (облачный)
  слайсинг, account-scoped (MF-1075, пересмотр 2026-07-11 — было v2, см. `../product/roadmap.md`
  § «Пересмотр скоупа v1»); базовый парк; публичный API v0.
- **v2:** **BambuAdapter** (охват #1) + PrusaAdapter; managed-cloud; телеметрия-агрегация; алерты
  парка; камера.
- **v3:** ферма 20+ дашборд, community-реестр, масштаб data-plane (100k), OctoPrint/Duet адаптеры;
  P2P-обмен и глобальный слайс-кэш (см. `../architecture/data.fragmentation.md` §8-9).

Эти пункты — целевая дорожная карта, не evidence текущего `dev`. Фактическая классификация API сейчас
ограничена `CONNECTION_MODES = ["list", "managed-local", "managed-bridge"]` в
`apps/api/src/profile/contract.ts`; `managed-cloud` и `custom` не являются наблюдаемыми server-side
режимами, пока не появится отдельный persisted mode и его рабочий control/telemetry path.

## 5. Риски/решения (для CTO)
- Node data-plane изолирован отдельным process; connection/frame/backpressure/load профили должны
  оставаться обязательным release gate, а не предположением о языке.
- Реверс-протоколы вендоров (Bambu) хрупкие — версионировать адаптер, деградация при смене протокола.
- Camera-трафик убьёт основной канал → отдельный путь + ленивость.
- Слайсинг на сервере дорог по CPU → очередь/лимиты, не в HTTP-запросе (apps/mesh-воркер).
