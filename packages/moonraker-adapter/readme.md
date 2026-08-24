# @portal/moonraker-adapter

Ядро коннекторов control-plane (MF-885, эпик MF-879, [docs/architecture/printer.server.md](../../docs/architecture/printer.server.md)
§2.2). Экспортирует единый контракт `PrinterDriver` (`getState`/`sendGcode`/`uploadFile`/
`start`/`pause`/`stop`/`subscribeTelemetry`/`camera`, см. `src/printerDriver.ts`) и первую
реализацию — `MoonrakerAdapter` для Klipper-принтеров (FLSun/Creality-K1/Ender-V3, пилот эпика).

## Почему отдельный пакет, а не `apps/api`

`support_level=managed` в связке managed-local не проходит через наш сервер вообще — сервер за
NAT не достанет принтер в LAN пользователя, достаёт только браузер того же LAN
(printer.server.md §1). Значит адаптер обязан быть исполним и на клиенте (браузер, `apps/web`),
и на сервере (`apps/api`/`apps/relay`, managed-cloud/managed-bridge и custom-через-туннель, v2).
Поэтому пакет:
- **изоморфен** — только `fetch`/`WebSocket` из глобальной области (доступны и в браузере, и в
  Node ≥22 через undici), никаких Node-специфичных импортов в проде (`ws` — только в
  `src/testing/fakeMoonraker.ts`, test-only devDependency);
- лежит в `packages/*`, а не внутри `apps/api`, чтобы `apps/web` мог зависеть от него напрямую
  без завязки на серверный процесс.

## Плагинная архитектура

Новый вендор (Bambu MQTT, PrusaLink/Connect, OctoPrint — v2, см. `docs/research/printer.protocols.md`)
= новая реализация `PrinterDriver` в своём модуле/пакете. Ядро (`printerDriver.ts`) не меняется —
только `ConnectorType` расширяется новым значением.

## Отношение к `apps/device-agent/src/driver/printerDriver.ts`

Это НЕ то же самое. `apps/device-agent` — внутренний контракт устройственного агента
(custom-уровень, MF-391): исполняется НА принтере, в его LAN, и уже имеет свою реализацию
`MoonrakerDriver` (status/pause/resume/cancel/uploadGcode/startPrint/camera/onStatusUpdate).
`@portal/moonraker-adapter` — коннектор control-plane для managed-уровня (сегодня — браузер
напрямую; позже — воркер relay/poller). Оба говорят с Moonraker по одному протоколу, но с
разных сторон сети и с разной формой интерфейса (архитектурный контракт §2.2 называет
`getState`/`start`/`pause`/`stop`/`subscribeTelemetry`, отличные имена от device-agent-контракта
намеренно — они не взаимозаменяемы). Слияние в одну реализацию — возможная будущая уборка, не
блокирует v1 и не входит в объём MF-885.

## Использование

```ts
import { MoonrakerAdapter } from "@portal/moonraker-adapter";

const driver = new MoonrakerAdapter({ httpUrl: "http://192.168.1.42:7125" });
await driver.connect();
const state = await driver.getState();
const unsubscribe = driver.subscribeTelemetry((snapshot) => console.log(snapshot));
```

Тесты (`src/moonrakerAdapter.test.ts`) доказаны против эмулированного Moonraker
(`src/testing/fakeMoonraker.ts`) — HTTP (`/access/oneshot_token`, `/server/files/upload`) + WS
JSON-RPC (`/websocket`), ровно тот срез реального API, который вызывает адаптер.
