# apps/device-agent — процесс на устройстве (MF-391, Фаза 2 эпика MF-26)

## Контракт identity.v1

Агент добавляет в heartbeat optional-поле `identity` (старые relay/API его игнорируют):
`schema`, enroll-derived `deviceId`, agent version, Moonraker/Klipper version, nullable model,
и SHA-256 `configFingerprint`. Fingerprint строится из доступных printer.cfg safety/geometry,
limit, nozzle и firmware settings с канонической сортировкой ключей. Неполученные значения остаются
`null`; агент не угадывает модель. Секреты, пути, MAC и serial не отправляются и не участвуют в
fingerprint. Изменение конфигурации меняет fingerprint; reconnect сохраняет deviceId из
зашифрованных enroll credentials. Relay/API принимают поле аддитивно и сохраняют redacted
identity в normalized device snapshot. После CSR enrollment `deviceId` читается из
`agent-identity.json`; legacy `credentials.enc` поддерживается только как миграционный read path.

Агент, который живёт рядом с принтером (Pi/ПК/Docker — API выдаёт bootstrap-команду через
`apps/api/src/modules/devices/infrastructure/install-script.ts`) и переводит протокол конкретной прошивки в единый
внутренний контракт `PrinterDriver` (`src/driver/printerDriver.ts`). Верхний слой агента (WS к
`apps/relay`, push телеметрии, подписанные команды с портала) работает ТОЛЬКО через этот
интерфейс — конкретный протокол принтера (Klipper/Moonraker, позже Bambu/Prusa/OctoPrint/
Creality, см. `user_printers.firmware_class`) он не видит.

## Активный relay v1

Реализовано и покрыто тестами:

- `src/credentials.ts` — локально генерирует private key/CSR, атомарно активирует индивидуальные
  identity/certificate/CA/public-verification files с mode `0600` и никогда не отправляет private
  key на сервер. Чтение `agent.key`/`credentials.enc` сохранено только для контролируемой миграции
  старых установок; новая установка этот симметричный формат не создаёт.
- `src/relay/client.ts` (`RelayClient`) держит одно outbound WSS-соединение к `apps/relay`, предъявляет
  индивидуальный client certificate и отвечает на challenge обязательным
  `hello{protocol_version:"v1", nonce, agent_version, capabilities}` без bearer token. Реконнект идёт
  с bounded exponential backoff+джиттером; после `hello_ack` агент сразу повторяет последний snapshot.
  `pushStatus()` ограничен одним кадром в секунду на устройство. Wire types и runtime validation
  импортируются через тонкий `src/relay/protocol-v1.ts` из единственного authority
  `@portal/contracts/device-protocol/v1`; локальных handwritten frame-копий нет.
- `main.ts` — переводит `PrinterStatusSnapshot` в `HeartbeatDeviceUpdate`: `progress` 0..1 →
  0..100 (device_state/device_telemetry.progress — numeric(5,2)), nozzle/bed/chamber/job — в
  `metrics` (свободная форма, jsonb, relay/api её не интерпретируют). `RELAY_URL` не задан —
  no-op-с-warn (тот же паттерн репо), драйвер против Moonraker продолжает работать локально без push.
- Nest relay принимает только валидный v1 heartbeat и передаёт его в API через authenticated
  `/internal/relay/v1/sessions/{sessionId}/heartbeat`; API обновляет авторизованный device snapshot.

**НЕ входит в этот шаг** (следующие Ф2-сабкарты MF-391):
- ~~Подпись команд токеном сессии, anti-replay nonce/seq — «шаг 3» (команды).~~ см. § MF-844 ниже.
- Chunked-докачка ≥100 МБ — «шаг 4» (файлы).
- UI-карточка `/printer/:id` в apps/web, читающая device_state push-ом — на момент этой карточки
  такой страницы в apps/web ещё нет вообще (не polling-реализация для замены, а отсутствующая
  страница) — вне зоны Back (apps/api/apps/relay/apps/device-agent), заводить/чинить фронтенд
  внутри бэкенд-карточки не стал; нужна отдельная карточка на Web/Design с этим каналом (relay →
  device_state, готов и протестирован) как источник данных.
- Несколько физических устройств в одном gateway-процессе разрешены только если API вернул их в
  авторизованном device set текущей mTLS-сессии; relay отвергает cross-gateway device frames.

## Статус карточки MF-844 («шаг 3» — команды pause/resume/cancel)

Реализована и покрыта тестами сторона агента (Bridge, «Агент-на-устройстве» — CLAUDE.md § «Твоя
зона»):

- `src/relay/protocol.ts` содержит только agent-local aliases; `command`, transport `command_ack` и
  explicit terminal `command_result` принадлежат canonical closed v1 contract.
- `src/relay/commandToken.ts` — верифицирует короткоживущий подписанный командный токен
  только Ed25519 public-key set из `COMMAND_VERIFICATION_KEYS`: обязательные `kid`, issuer,
  audience, gateway/command ids, `jti`, `iat`/`nbf`/bounded `exp` и адресат команды проверяются
  до обращения к драйверу. Симметричного fallback и signing material на клиенте нет.
- `src/relay/commandHandler.ts` (`CommandHandler`) — второй независимый слой проверки (не
  доверяет токену слепо): белый список ролей `owner`/`operator` (`device_shares.role`), сверка
  команды с `DriverCapabilities.supportedCommands` ЭТОЙ прошивки/конфига, anti-replay (`seq`
  строго монотонный на устройство) и persistent bounded terminal-result ledger (дедуп по
  `commandId`/sequence переживает reconnect и restart) — только после этого реально зовёт
  `driver.pause()/resume()/cancel()` и возвращает explicit `command_result` с кодом
  (`role_not_allowed`, `command_not_supported`, `replay_rejected`, `invalid_token`,
  `command_failed`, …).
- `src/relay/client.ts`/`main.ts` — `RelayClient.onCommand` подключает `CommandHandler` к входящим
  `command`-кадрам, шлёт результат обратно в тот же сокет.

**Смежные границы:**
- Nest relay claim/lease/result lifecycle и API-owned PostgreSQL queue находятся в `apps/relay` и
  `apps/api/src/modules/relayInternal`; agent не читает Portal DB и не принимает internal service token.
- api-сторона: выпуск Ed25519 command token с серверным private JWK и ротацией публичных `kid`, HTTP-эндпоинт для веба
  (`POST /devices/:id/commands/:command`), проверка `device_shares.role` на выпуске, запись
  `device_audit_log` (`command.pause`/`command.resume`/`command.cancel`, `actor_user_id`) — та же
  companion-карточка (Back).
- Web UI (кнопки паузы/резюме/отмены, отображение ack/явной ошибки) — страницы `/printer/:id` в
  `apps/web` ещё нет вообще (см. § MF-843 выше), тот же вывод, что там: отдельная карточка
  Web/Design.

## Статус карточки MF-391 «шаг 1» (Moonraker-драйвер)

Реализовано и покрыто тестами (`src/driver/moonraker/moonrakerDriver.test.ts` — против
эмулированного Moonraker, `src/testing/fakeMoonraker.ts`, «готово когда» карточки прямо
допускает «реальный (или эмулированный) Moonraker»):

- `connect`/`disconnect`, `capabilities`, `status`, `pause`/`resume`/`cancel`, `startPrint`,
  `uploadGcode` и `uploadGcodeStream` (потоковый multipart upload без буфера всего файла), `camera`, `onStatusUpdate` (push БЕЗ
  polling — Moonraker сам шлёт `notify_status_update` после `printer.objects.subscribe`).
- Авторизация WS-хендшейка через oneshot-token: если у Moonraker включена `[authorization]`
  (`apiKey` задан в конфиге агента), драйвер сначала берёт `GET /access/oneshot_token`
  (`X-Api-Key`, ключ не покидает этот процесс), открывает WS с этим одноразовым токеном в
  query-string. Без `apiKey` — прямое подключение (trusted-LAN режим Moonraker), агент явно
  решает это по конфигу, не «предполагает доверенную сеть».

**НЕ входит в этот шаг** (следующие Ф2-сабкарты MF-391, поверх этого же интерфейса — «шаг 2»,
телеметрия, сделан отдельно, см. секцию выше):
- Подпись команд токеном сессии (owner PlagID/device id/роль), anti-replay nonce/seq,
  идемпотентность через reconnect — «шаг 3» (команды). Этот драйвер лишь исполняет
  pause/resume/cancel/start НА Moonraker, не проверяет, кто и с каким правом их вызвал —
  это ответственность командного слоя выше, который сверяется с
  `DriverCapabilities.supportedCommands` и белым списком по роли ДО вызова.
- Chunked-докачка ≥100 МБ с резюме по отдельному файловому каналу relay реализована в
  `src/relay/fileTransfer.ts`: чанки и состояние `transferId` лежат на диске, а после последнего
  чанка вызываются потоковый `uploadGcodeStream` и, при `startPrint=true`, `startPrint`.

## Контракт `PrinterDriver`

См. `src/driver/printerDriver.ts` — единственный источник правды, комментарии в файле
объясняют инварианты (например: `onStatusUpdate` не обязателен для MVP-драйвера, верхний слой
не должен на него жёстко полагаться). Будущий драйвер (Bambu/Prusa/OctoPrint/Creality)
реализует этот же интерфейс — ничего в relay/командном/телеметрийном слое не меняется.

## Локальный запуск

Production запускается из подписанного автономного bundle в versioned release directory;
checkout монорепозитория и `workspace:*` resolution на клиенте не нужны. Connector выбирается
только валидированным `DEVICE_CONNECTOR_CONFIG`. Сейчас production registry поставляет generic
Moonraker; Snapmaker остаётся experimental и не входит в production graph до полного lifecycle
contract. CSR enrollment локально создаёт `gateway-key.pem` (mode `0600`), а API возвращает
certificate/CA chain и bounded Ed25519 public-key set. В agent home нет command signing secret.

`health.v1` возвращает отдельные Moonraker/Relay substates, revision, release version/commit и
reason code. `healthy` появляется только после Moonraker readiness и `hello_ack`; локальный режим
без Relay — `degraded/relay_not_configured`; invalid public-key/config — `blocked_config`; revoke —
`revoked`. Payload не содержит URL, certificate, key или token.

```bash
# Против реального Moonraker в LAN, без push в relay:
DEVICE_CONNECTOR_CONFIG='{"type":"moonraker","httpUrl":"http://<printer-ip>:7125"}' \
  AGENT_VERSION=0.0.0-dev AGENT_COMMIT_SHA=$(git rev-parse --short HEAD) pnpm --filter @portal/device-agent dev

# Standalone signed bundle enrolls locally: only the CSR and one-time code leave the host.
MULTICA_API_URL=https://api.example.invalid MULTICA_ENROLL_CODE='one-time-code' \
  MULTICA_AGENT_HOME=/var/lib/3mf-device-agent \
  node /opt/3mf-device-agent/current/.release-dist/main.js --enroll

# С push в relay MULTICA_AGENT_HOME содержит agent-identity.json, gateway-key.pem,
# certificate/CA и command-verification-keys.json. RELAY_TLS_* не нужны для default paths.
DEVICE_CONNECTOR_CONFIG='{"type":"moonraker","httpUrl":"http://<printer-ip>:7125"}' \
  RELAY_URL=ws://127.0.0.1:3010/relay/ws MULTICA_AGENT_HOME=/var/lib/3mf-device-agent \
  AGENT_VERSION=0.0.0-dev AGENT_COMMIT_SHA=$(git rev-parse --short HEAD) pnpm --filter @portal/device-agent dev

# Тесты — против эмулированного Moonraker и локального fake relay-сервера, без реального железа:
pnpm --filter @portal/device-agent test
```
