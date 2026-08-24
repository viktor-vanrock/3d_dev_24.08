# Контракт данных «уровень поддержки → рабочее состояние» v1 (MF-1199)

Владелец семантики — Data; исполняемый код — Back (`apps/api/src/profile/contract.ts`,
MF-1244); fixture — [`fixtures/printer.operating.v1.json`](fixtures/printer.operating.v1.json).
Reusable surface (браузерные состояния managed-local) — Design/UX,
[`printer.surface-states.md`](../design/printer.surface-states.md). Этот документ не меняет ни
одну из существующих реализаций — он формализует уже принятые факты в одну версионируемую схему,
чтобы Fullstack и QA брали детерминированную фикстуру по контракту, а не угадывали класс
соединения.

## 1. Две независимые оси — не путать

Модель принтера и конкретный экземпляр пользователя описываются **разными** полями с разным
владельцем и разной частотой изменения. Council/Fleet-документы уже используют оба слова
(«support_level», «connection_mode») — здесь фиксируется, что это не синонимы:

| Ось | Поле(я) | Где живёт | Кто меняет | Значения |
|---|---|---|---|---|
| **Каталожное обещание модели** | `support_level`, `connector_type`, `firmware_ready`, `firmware_public` | `printers` (миграция `20260710440000_printer_support_levels.sql`) | Data / Ресёрчеры | `support_level ∈ {list, managed, custom}`; `connector_type ∈ {moonraker, bambu-mqtt, prusa-link, octoprint, vendor-cloud, none, null}` |
| **Фактическое подключение экземпляра** | `connection_mode` (persisted) | `user_printers` | Back (`resolveConnectionMode`) | `CONNECTION_MODES = ["list", "managed-local", "managed-bridge"]` (`apps/api/src/profile/contract.ts`) |

**Реконсиляция (то, что не совпадает сегодня и почему это не баг):** UX-гейтинг мастера
(`printer.support.md` § «Гейтинг уровней по модели», `apps/web/src/park/gating.ts`) показывает
**пять** плиток — `list`/`managed-local`/`managed-cloud`/`managed-bridge`/`custom` — как обещание
каталога. Персистентный `connection_mode` знает только **три** значения. Это не рассинхрон,
который нужно чинить прямо сейчас: `managed-cloud` и `custom` — модельные обещания без
подтверждённого server-side control/telemetry контура (`printer.server.md` §2.2.1–§2.2.2,
строки «Unknown»; §4: «Фактическая классификация API сейчас ограничена
`CONNECTION_MODES`… `managed-cloud` и `custom` не являются наблюдаемыми server-side режимами»).
Пока не появится собственный factual gate Fleet под эти режимы, никакой экземпляр не может
получить `connection_mode` `managed-cloud`/`custom` — только `list`/`managed-local`/
`managed-bridge`. Это подтверждено тестом:
`resolveConnectionMode("managed-cloud", "connector")` → `"list"` (deny-by-default,
`contract.test.ts`).

## 2. Источник состояния и свежесть по `connection_mode`

| `connection_mode` | Источник факта | Что персистится сервером | Freshness |
|---|---|---|---|
| `list` | Нет источника — управления нет по определению | Ничего | Не применимо |
| `managed-local` | Прямой browser→Moonraker запрос (см. `printer.surface-states.md`) | **Ничего.** Сервер не видит и не хранит результат локальной пробы | Живёт только в текущей вкладке браузера; `last_confirmed_at` в серверном ответе всегда `null` |
| `managed-bridge` | Relay heartbeat → `device_state.updated_at` | `state_status`, `state_updated_at`, `metrics`, `progress`, `seq` | `now - state_updated_at > DEVICE_STATE_STALE_AFTER_MS (45000мс)` ⇒ `stale` |

`GET /me/printers/:id/live` — единственная owner-scoped проекция этой таблицы наружу
(`apps/api/src/profile/activation.ts`); нормализованная форма и гарантии — fixture ниже.

## 3. Таксономия: unknown / unavailable / unsupported

Три причины «нет доступа к возможности» требуют разного признания и разного будущего. Смешивать
их в один текст или один код — то же нарушение правила `printer.surface-states.md` §3
(«никаких непроверенных переходов»), перенесённое на модельный/инстанс-слой.

- **`unsupported`** — структурный факт, не изменится без нового технического решения/железа.
  - Модель: `connector_type = 'none'` (подтверждённо нет открытого локального API — Marlin и
    т.п., комментарий колонки в миграции).
  - Инстанс: серверный telemetry-канал для `managed-local`/`list` отсутствует **по архитектуре**
    (§1 `printer.server.md`, managed-local — browser-only решение совета, не пробел реализации).
- **`unknown`** — факт ещё не собран; может стать `unsupported` или полноценно доступным, когда
  появится evidence.
  - Модель: `connector_type = null` — «ещё не классифицирован», явно отделено от `'none'`
    комментарием колонки (`connector_type` DDL). Ресёрчеры заполняют это позже без миграции.
  - Инстанс: `managed-bridge`, у которого агент никогда не подключался (`agent_id = null` /
    `state_updated_at = null`) — это не то же самое, что структурное отсутствие канала у
    `managed-local`/`list`.
- **`unavailable`** — evidence есть, возможность подтверждённо недоступна сейчас (временно или
  до отдельного действия пользователя).
  - Инстанс: `offline`, `stale`, `permission_denied` (agent revoked), `server_error`
    (инфраструктурный сбой запроса, не доменный факт — см. §4).
  - Браузерный слой managed-local: `helper unavailable`, `direct timeout/error`, `LAN-only`
    (`printer.surface-states.md` §2) — тот же принцип, другой источник (браузер, не API).
  - Модель: `custom` c `firmware_ready = false` — «скоро», не «никогда» (`gating.ts` reasonKind
    `"soon"`), в отличие от `custom` с `connector_type = 'none'` — это уже `unsupported`.

### Найденный разрыв — `live_availability_reason = "no_telemetry_channel"` смешивает `unsupported` и `unknown`

`resolveOperatingState` (`apps/api/src/profile/contract.ts`) присваивает **один и тот же** код
`no_telemetry_channel` в двух разных по природе случаях:

```ts
if (connectionMode === "managed-local" || connectionMode === "list") {
  reason = "no_telemetry_channel";              // структурно — unsupported на этом слое
} else if (row.agent_revoked_at !== null) {
  reason = "permission_denied";
} else if (!row.agent_id || !stateUpdatedAt) {
  reason = "no_telemetry_channel";              // ещё не подключался — unknown
}
```

Потребитель контракта (Front, QA, аналитика охвата парка) не может отличить «этот режим
структурно никогда не даст server-side телеметрию» от «агент этого экземпляра просто ещё не
подключился» — оба значения приходят как один и тот же `no_telemetry_channel`. Это не баг
текущей поставки MF-1244 (её приёмка не требовала такого различия) — это фиксируемый в этом
контракте пробел на будущее: любое построение метрики вида «сколько принтеров недоступно
навсегда» по сырому `live_availability_reason` сегодня даст ложный результат для ещё не
подключавшихся `managed-bridge` экземпляров.

**Рекомендация (не блокирует эту карточку, отдельное владение Back):** при следующей аддитивной
версии контракта завести отдельное значение (например, `not_yet_connected`) для случая
«канал существует, evidence ещё не поступал», оставив `no_telemetry_channel` только для
структурного `managed-local`/`list`. До этого — downstream-потребители обязаны трактовать
`no_telemetry_channel` как «нельзя судить о будущем», а не как окончательный факт.

### Тот же паттерн на модельном слое — `apps/web/src/park/gating.ts`

`GateReasonKind = "model" | "soon"` — оба случая `connector_type === null` (unknown, «данные ещё
не собраны») и `connector_type === 'none'` (unsupported, «недоступно этой модели») возвращают
**один и тот же** `reasonKind: "model"`, различаясь только свободным русским текстом
(`localConnectorReason`, `apps/web/src/park/gating.ts`). Для человека в UI это ок — тексты разные
и честные. Для машинного потребителя (аналитика гейтинга, будущий QA-снапшот по каталогу)
`reasonKind` сегодня не различает «ещё не исследовали» от «точно не подходит». Тот же
рекомендательный вывод: будущее расширение `GateReasonKind` (например, `"unclassified"` отдельно
от `"model"`) — на усмотрение владельца файла (Front), не предписывается этим контрактом.

## 4. Что НЕ хранится и НЕ выводится (негативный контракт)

- Сервер никогда не персистит live-состояние `managed-local` (температуры, job, capabilities) —
  оно существует только в текущей вкладке браузера и не попадает в `device_state`.
- `custom` не является персистентной классификацией `connection_mode` и **не должна** выводиться
  из `firmware_class`/факта наличия agent-heartbeat (`printer.server.md` строки 80–81: «`custom`
  is also not a persisted server classification; it must not be inferred from `firmware_class`
  alone»).
- `managed-cloud` не имеет сегодня никакого server-side состояния — любой UI/аналитика, что
  показывает live-статус `managed-cloud`, изобретает evidence, которого нет.
- `last_confirmed_at` не бэкфиллится из прошлого `connection_mode`/сессии: ветка
  `no_telemetry_channel` всегда обнуляет его, даже если в старой jsonb-строке `capabilities`
  остались данные другого источника (уже реализовано — `resolveOperatingState`, закрепляем как
  инвариант контракта, не только деталь реализации).
- IP LAN-адрес, enroll-код, credential, сырой agent-payload и raw command-текст никогда не
  попадают в `printer_operating.v1` ответ — см. `guarantees` fixture ниже и
  `contract.test.ts` (`not.toMatch(/lan_endpoint|token|credential|secret/i)`).
- `server_error` — не доменный факт о принтере, а признак сбоя самого запроса (упавший
  `loadPrinterOwner`/`pool.query`, `apps/api/src/profile/activation.ts` строки 592/631). Его
  нельзя агрегировать вместе с `offline`/`stale` как «состояние принтера» — это состояние
  запроса к нашему серверу.

## 5. Риск миграции

- **Null ≠ none уже разделены миграцией** (`20260710440000_printer_support_levels.sql`):
  бэкфилл `connector_type='moonraker'` шёл только по надёжному facet-флагу; остальное осталось
  `null`. Риск — будущий backfill-скрипт, который по ошибке проставит `'none'` туда, где данных
  просто не было, тем самым молча превратит «неизвестно» в «неподдерживаемо навсегда» по всему
  каталогу. Любой новый backfill обязан явно проверять источник факта, а не дефолтить в `none`.
- **`resolveConnectionMode` молча схлопывает нераспознанное значение в `list`**
  (`contract.test.ts`: `resolveConnectionMode("managed-cloud", "connector")` → `"list"`). Это
  безопасный deny-by-default сегодня, но когда `managed-cloud`/`custom` станут реальными
  персистентными режимами, этот же fallback тихо занизит их до `list` для старых строк без явной
  миграции данных — добавление нового режима в `CONNECTION_MODES` обязано сопровождаться data
  migration, а не только новым значением в типе.
- **Аддитивность контракта.** Любое расширение `LIVE_AVAILABILITY_REASONS`/`CONNECTION_MODES`
  должно быть только добавлением новых значений; существующие значения нельзя переопределять
  (тот же принцип, что и в `relay-command-result.v1.md`).

## 6. Риск telemetry

- `DEVICE_STATE_STALE_AFTER_MS = 45_000` — сегодня голая константа в коде, а не версионированная
  часть контракта/fixture. Если pipeline телеметрии (`printer.server.md` §2.4, разделение
  горячего/холодного хранилища) изменит частоту heartbeat, граница `stale` разъедется с реальным
  тактом устройств без bump версии контракта. Рекомендация: перед изменением §2.4 вынести эту
  константу в контракт (например, добавить поле `stale_after_ms` в fixture) и обновить эту
  таблицу вместе с ней.
- Граница `stale` сегодня проверяется в один момент запроса (`now` в `resolveOperatingState`), не
  инкрементально — при высокой нагрузке на `device_state` (100k принтеров, `printer.server.md`
  §2.4 hot/cold split) корректность этой проверки зависит от того, что `state_updated_at`
  обновляется тем же горячим хранилищем, что читает `/live`; при переезде на раздельные
  hot/cold store это нужно перепроверить, а не считать доказанным этим документом.

## 7. Приёмка для Fullstack/QA (готова к реализации)

Fixture [`printer.operating.v1.json`](fixtures/printer.operating.v1.json) дополнен примерами
`examples` — по одному детерминированному объекту на `connection_mode` × `live_availability_reason`
из §2–§3, включая структурный `list`/`managed-local` и оба случая `no_telemetry_channel` (unknown
vs unsupported, см. §3) — так Fullstack/QA берут фикстуру состояния/действия по ключу, не
угадывая класс соединения и не путая «навсегда» с «пока нет данных».

- Каждый пример — валидный ответ `GET /me/printers/:id/live` по форме `response` того же файла.
- Ни один пример не содержит IP/token/credential/секретов (то же правило `guarantees`).
- `managed-local`/`list` примеры всегда имеют `last_confirmed_at: null` (§4).
- Тест `apps/api/src/profile/contract.test.ts` продолжает проходить без изменений — новые ключи
  фикстуры аддитивны.

## Основания и lineage

- `docs/epics/printer.support.md` § «Три уровня поддержки», § «Гейтинг уровней по модели» —
  `2d7f8fd`, Data, 2026-07-12.
- `docs/architecture/printer.server.md` §1, §2.2.1–§2.2.4, §2.2.5, §4 — `941fa81` (базовый),
  дополнения MF-1835/MF-1841.
- `docs/design/printer.surface-states.md` §1–§3, §5, §5а — канон reusable surface v1.
- `apps/api/db/migrations/20260710440000_printer_support_levels.sql` — DDL и комментарии колонок
  `connector_type`/`support_level`/`firmware_ready`/`firmware_public`.
- `apps/api/src/profile/contract.ts`, `contract.test.ts` — реализация MF-1244 (Back).
- `apps/web/src/park/gating.ts` — модельный гейтинг мастера (MF-903, Front).
- Родитель: [MF-1193](mention://issue/57f73ee3-9fab-454e-b8da-67c81fa702cb) (эпик, done);
  этап 2 direction-карточка — [MF-1199](mention://issue/b7b0d9b0-0f8a-415f-9490-0bea908ca748).
