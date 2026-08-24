# MF-1347 — аудит API-контракта user↔printer

Дата проверки: 2026-07-17. Контур: read-only. Код и данные не менялись, `origin/dev` не мутировался
кроме публикации этого отчёта. Основания: [публичный API](../api.public.md), вердикт MF-1076 в
[domain.model.md](../epics/domain.model.md#user_api_keys--config_fingerprint-mf-1076-вердикт-data-к-mf-1075-п4--вердикт-схема-прогнана-вперёд-назад),
предыдущий аудит [MF-1315](mf-1315-user-printer-api.md) (2026-07-12, за 5 дней до этой проверки).

Это переаудит того же контура, а не первичный обход: за 5 дней в `apps/api/src/publicapi/*` и
`apps/api/src/devices/relayInternal.ts` прошло больше десятка коммитов (`user_api_keys`
gate-переключение и откат, rate-limit metadata, capability policy, device-agent identity) —
ниже фиксируется, что из выводов MF-1315 всё ещё верно, что изменилось, и один новый разрыв,
которого предыдущий аудит не заметил.

## Метод

Код читан на актуальном `origin/dev` (`git fetch origin dev`, fast-forward). Проверялись:
`apps/api/src/publicapi/v0.route.ts` (маршруты `/v0/printers*`), `apps/api/src/publicapi/apiKey.ts`
и `keys.route.ts` (`/me/api-keys*`), `apps/api/src/devices/relayInternal.ts` (запись
`device_state`/`device_telemetry` из heartbeat агента), `apps/device-agent/src/identity.ts`
(источник `identity.v1`), `apps/api/src/printers/command-policy.ts` (fail-closed политика команд),
сопоставление с `docs/api.public.md`. DDL/данные не менялись, только чтение файлов и `git log`.

## Что из MF-1315 подтверждено и что изменилось

| # | Разрыв из MF-1315 (2026-07-12) | Текущее состояние (2026-07-17) |
|---|---|---|
| 1 | Заголовок `GET /v0/printers` («Список принтеров владельца ключа») уже, чем факт (код также отдаёт расшаренные) | **Устранено на уровне доки.** Секция «Доступ к конкретному принтеру» (`docs/api.public.md`) теперь явно перечисляет обе роли — `user_printers.user_id` → `owner`, `device_shares` → `owner/operator/viewer/guest`. Заголовок эндпоинта остался коротким, но соседний текст полностью снимает двусмысленность. Код (`v0.route.ts:129-141`, `resolveDeviceRole`) не менялся — разрыв не расширился, просто описан. |
| 2 | `/v0` использует legacy `api_keys`, а не подготовленную MF-1076 `user_api_keys`; API-дока не разделяла контракты явно | **Подтверждено как текущая истина, дока теперь это фиксирует явно** — новая секция «Граница моделей ключей и scopes» + таблица маршрутов с колонкой «Bearer legacy `api_keys`». Важно: между аудитами был короткий период рассинхрона — `7c88d826` (2026-07-15, MF-1336) переключил `requirePublicApiKey` на `user_api_keys`, что **противоречило** уже задокументированной границе; откачено `e6769492` (2026-07-17, MF-1778) тем же днём, обратно на `api_keys`. На текущем `HEAD` код и доки снова совпадают, но это показывает, что граница легко ломается повторно — стоит закрыть тестом-инвариантом на стороне CI, а не только доверять ревью (тест уже есть — `v0.route.test.ts` после отката снова кодирует путь через `api_keys`, но специального contract-теста «не должен читать `user_api_keys`» нет). |
| 3 | `capabilities`, `user_id`, `printer_id`, `link_source`, fingerprint-поля MF-1076 не сериализуются в `/v0/printers` | Подтверждено без изменений: `serializePrinter()` (`v0.route.ts:99-110`) отдаёт ровно `id/brand/model/connector_type/state/progress/job_id/metrics/state_updated_at/last_seen_at` — то же множество полей, что 5 дней назад. Разрыв не расширился, доки по-прежнему не обещают эти поля. |
| 4 | `GET /v0/printers/:id/commands/:commandId` — прежний аудит отметил, что привязку команды к устройству и владельцу «стоит проверить отдельно» | **Уточнение, не разрыв**: код уже это делает и делал 5 дней назад — `resolveDeviceRole(id, key.ownerId)` (существование/владение принтером) **и** `where id = $1 and device_id = $2` в самом SELECT команды (`v0.route.ts:439-453`) — двойная проверка, IDOR невозможен. Предыдущий аудит зафиксировал это как открытый вопрос вместо подтверждённого факта; закрываю здесь. |

## Новый разрыв: `identity.v1` (Klipper `config_fingerprint`) утекает через `metrics` в публичный API

MF-1076 явно определяет `config_fingerprint` как отдельное, не сериализуемое в `/v0` поле
(зафиксировано в вердикте MF-1076 и подтверждено обоими аудитами — п.3 выше). Однако с
`7c705536` (2026-07-12, **до** снимка MF-1315, разрыв там не замечен) device-agent для
Klipper/Moonraker передаёт в heartbeat дополнительный блок `identity` вида:

```ts
// apps/device-agent/src/identity.ts
{ schema: "identity.v1", deviceId, model, agentVersion, klipperVersion, configFingerprint, configSource }
```

Сервер кладёт этот блок целиком внутрь `metrics`, без фильтрации:

```ts
// apps/api/src/devices/relayInternal.ts:154-162
const identity = typeof e.identity === "object" && e.identity !== null && !Array.isArray(e.identity)
  ? (e.identity as Record<string, unknown>)
  : null;
if (identity && identity.schema === "identity.v1") metrics.identity = identity;
```

...и записывает этот `metrics` (с вложенным `identity`) и в `device_state`, и в `device_telemetry`
(`relayInternal.ts:167-176`, оба `insert ... metrics = $4/$3`). Оба публичных v0-маршрута отдают
`metrics` без редактирования:

```ts
// v0.route.ts:99-110 (GET /v0/printers, GET /v0/printers/:id)
metrics: row.metrics ?? {},
// v0.route.ts:187-195 (GET /v0/printers/:id/telemetry)
metrics: row.metrics ?? {},
```

Итог: любой Bearer-ключ со scope `read` на agent-подключённый (Klipper) принтер получает в ответе
`metrics.identity.configFingerprint` — тот самый MF-1076 fingerprint, который и вердикт MF-1076, и
`docs/api.public.md` (описание `metrics` в разделе «Модель v0» перечисляет только
`nozzle_temp_c`/`bed_temp_c`/`chamber_temp_c`/…, `identity` не упомянут нигде в файле —
`grep -n identity docs/api.public.md` не находит) явно относят к непубличной зоне. Заодно
утекают `klipperVersion`, `agentVersion` и второй `model` (Moonraker-репортированный, может не
совпадать с каталожным `row.model`, который уже возвращается отдельно) — ни одно из этих полей не
описано как часть контракта `/v0`.

Проверка через grep подтверждает отсутствие какой-либо редакции по пути relay → device_state/
device_telemetry → v0 serializer:

```bash
grep -n "metrics.identity" apps/api/src/devices/relayInternal.ts
#   162:      if (identity && identity.schema === "identity.v1") metrics.identity = identity;
grep -rn "metrics.identity\|delete.*identity" apps/api/src/publicapi/
#   (пусто — нигде не вычищается)
```

Тесты `v0.route.test.ts` не покрывают этот путь (нет ни одной фикстуры с `identity` в `metrics`),
поэтому регресс не был бы замечен CI. Это не межпользовательская утечка (владелец видит только
fingerprint своего же принтера через свой же ключ, `resolveDeviceRole` не нарушен), поэтому не
поднимаю severity до security-инцидента — это разрыв schema↔API/доки и нарушение явной границы
MF-1076, а не IDOR.

Решение — за владельцем контура (API/Devices, тот же владелец, что закрывал MF-1076/MF-1315):
либо убрать `identity` из `metrics` перед сериализацией в `v0.route.ts` (нужен ли `identity`
внешнему потребителю вообще — маловероятно, это внутренняя диагностика агента), либо явно
задокументировать `metrics.identity` как публичное поле и решить, безопасно ли раскрывать
`configFingerprint`/`klipperVersion` вовне. Само по себе поле не секрет (fingerprint — SHA-256 от
safety-конфига, без путей/серийников/MAC — см. комментарий в `identity.ts`), но публикация без
решения обходит инвариант, который MF-1076 явно объявил внутренним.

## `/me/printers` (первый частный cookie-контур, вне `docs/api.public.md`)

Для контекста: `GET /me/printers` (`apps/api/src/profile/activation.ts:261-317`) — сессионный
эндпоинт ЛК, не часть публичного API-контракта — там же прокидывается `metrics: row.state_metrics`
без фильтрации, то есть тот же `identity` виден и здесь. Это ожидаемо и не разрыв: юзер смотрит
собственное устройство под собственной сессией, ownership проверяется `where up.user_id = $1`.
Упоминаю только чтобы явно провести границу: находка выше — про `/v0/*` (внешний Bearer-контракт
из `docs/api.public.md`), не про этот приватный экран.

## Итог и владельцы

1. **Новое**: `metrics.identity` (MF-1076 `config_fingerprint` + `klipperVersion`/`agentVersion`)
   утекает в `/v0/printers`, `/v0/printers/:id`, `/v0/printers/:id/telemetry` без редактирования и
   без упоминания в доке — владелец API/Devices, решение: убрать поле из сериализации либо
   продокументировать и явно принять риск.
2. Разрыв `api_keys` vs `user_api_keys` (MF-1315 п.2) на `HEAD` устранён (доки и код совпадают), но
   был сломан и восстановлен между аудитами за счёт того, что в CI нет contract-теста именно на
   «`/v0` не должен трогать `user_api_keys`» — стоит завести такой тест, чтобы третий откат не
   потребовал ручного аудита снова — владелец API/QA.
3. Пункты MF-1315 №1 и №3 подтверждены без изменений; см. таблицу выше — новых действий не требуют.

Свежесть оснований на момент проверки (`git log -1 --format="%h | %ad | %s" --date=short -- <path>`):

```text
docs/api.public.md                                4ac5d4bf | 2026-07-15 | feat(MF-1321): зафиксировать rate-limit metadata и request correlation
apps/api/src/publicapi/v0.route.ts                e6769492 | 2026-07-17 | fix(MF-1778): вернуть Bearer-гейт /v0 на api_keys вместо user_api_keys
apps/api/src/publicapi/apiKey.ts                  1283cbff | 2026-07-13 | fix(api): усилить жизненный цикл API-ключей (MF-1284)
apps/api/src/publicapi/keys.route.ts              f11366c7 | 2026-07-15 | feat(api): добавить rate-limit metadata в API key ответы MF-1324
apps/api/src/devices/relayInternal.ts             1879878c | 2026-07-17 | MF-1066: базовая репутация вкладчика (trusted uploader) — ось 3 доверия
apps/device-agent/src/identity.ts                 7c705536 | 2026-07-12 | feat(device-agent): add identity v1 fingerprint
apps/api/src/printers/command-policy.ts           2ca2af7b | 2026-07-15 | feat(api): закрыть cloud-команды политикой MF-1142
docs/epics/domain.model.md                        205a2853 | 2026-07-17 | feat(api): эквайринг ЮKassa — создание платежа и идемпотентный вебхук (MF-1025)
```
