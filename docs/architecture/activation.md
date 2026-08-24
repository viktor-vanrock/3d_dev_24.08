# Активация: first-run/onboarding (architecture-слой)

**Модульная карта и контракты first-run/activation по факту реализации MF-436 в `dev`.**
Это документ границ и потока данных между API и web — что персистится, кто пишет, какой
контракт между слоями. Продуктовые правила (зачем шаги, что значит каждое поле для юзера) —
[docs/product/activation.md](../product/activation.md); визуал/паттерны —
[docs/design/activation.md](../design/activation.md). Здесь эти темы не дублируются.

Происхождение: эпик MF-435 «профиль активации главной» (кабинет MF-15), Фаза 1 = MF-436.

## 1. Модули и границы

| Слой | Файл | Роль |
| --- | --- | --- |
| API — роуты + стейт-машина | `apps/api/src/profile/activation.ts` | Единственный писатель `user_activation`; `GET`/`PATCH /me/activation`, `/me/printers*`, `/me/filaments*`, `/me/activation/events` |
| API — схема | `apps/api/db/schema.sql` (таблица `user_activation`), миграция таксономии событий — `apps/api/db/migrations/20260710140000_activation_events_taxonomy.sql` | Источник истины состояния активации, констрейнты enum-полей |
| Web — клиент состояния | `apps/web/src/home/activation.ts` (`useActivation`, `resolveTier`) | Единственная точка чтения/записи activation-состояния с фронта; управляет локальными копиями `printers`/`filaments` |
| Web — first-run флоу | `apps/web/src/home/firstrun.tsx` (`computeFirstRunStep`, `FirstRunFlow`) | Чистая функция шага + оркестратор рендера ровно одного шага |
| Web — чек-лист | `apps/web/src/home/checklist.tsx` (`ActivationChecklist`) | Персона-зависимый набор шагов, пишет `activation_checklist`, инициирует переход `first_run_completed` |
| Web — inferred-персона | `apps/web/src/home/inferpersona.ts` (`useInferredPersona`) | Молчаливый side-effect хук, патчит `primary_persona`/`persona_source` по поведенческим сигналам |
| Web — @-хендл (до дома) | `apps/web/src/auth/onboarding.tsx` (`HandleOnboarding`) | Отдельный от activation экран — `AuthGate` рендерит его вместо приложения, пока `handle_confirmed === false`; пишет через `PATCH /me` (session.ts), не через `/me/activation` |
| Web — оркестрация главной | `apps/web/src/home/home.tsx` (`HomeScreen`) | Единственное место, где видна смена `activation.state` целиком (логирует `home_view`/`first_run_start`/`state_changed`); монтирует `FirstRunFlow` только когда `state === "first_run"` и есть `user` |
| Web — события | `apps/web/src/home/track.ts` (`trackActivation`) | Тонкий fire-and-forget фасад над `POST /me/activation/events` |

**Границы явные:** `HandleOnboarding` (выбор @-хендла) — это не первый шаг activation-флоу, а
предшествующий гейт другого домена (`session.ts`/`PATCH /me`). Activation-стейт-машина (`user_activation`)
не знает о `handle_confirmed`; они последовательны в UX, но не связаны контрактом данных.

## 2. Данные: одна строка на пользователя

`user_activation` — PK `user_id`, `ON DELETE CASCADE` от `users`. Полный набор полей и колонок —
`apps/api/db/schema.sql` (таблица `user_activation`); enum-констрейнты БД (`state`, `primary_persona`,
`persona_source`, `home_tier`) зеркалятся allowlist-массивами в `activation.ts` (`PERSONAS`, `TIERS`) —
это два независимых места одного и того же контракта, менять синхронно.

Строка создаётся лениво в `loadActivation()` (upsert на первый `GET /me/activation`), там же
инкрементируется `sessions_seen` и проверяется авто-переход в `returning`. Никакого отдельного
эндпоинта «начало сессии» нет — сознательное упрощение (см. комментарий в коде).

## 3. Контракт API ↔ web

Дом читает/пишет activation-состояние **только** через `apps/api/src/profile/activation.ts`
(критерий Фазы 1 MF-436) — никакого localStorage-состояния флоу на клиенте.

- `GET /me/activation` → `{ activation, printers, filaments }` — единый снапшот, из которого
  `computeFirstRunStep()` детерминированно выводит текущий шаг флоу (без отдельного клиентского
  стейта — переживает reload).
- `PATCH /me/activation` — частичное обновление через динамический `sets`/`values` билдер;
  принимает `state` напрямую (служебный путь, флоу им не пользуется), `primary_persona`+`persona_source`,
  `home_tier`, `first_run_completed` (алиас на `state = returning` + `first_run_completed_at = now()`),
  `activation_checklist`, `home_dismissed_prompts`. Ответ — обновлённая строка целиком; клиент (`activation.ts`)
  всегда заменяет локальный `activation` этим ответом, не мёржит частично.
- `POST /me/printers` / `DELETE /me/printers/:id` — сторонний ресурс (`user_printers`), но
  пишет `user_activation.has_printer` как побочный эффект (add → `true`; delete → `true`, если
  парк не опустел, иначе `false`). Это единственная связь между printer-CRUD и activation-таблицей;
  сам `POST /me/printers` **не** трогает `state`.
- `POST /me/activation/events` — allowlist `ACTIVATION_EVENT_NAMES` (`apps/api/src/analytics/events.ts`),
  уже своё, отдельное от общего `EVENT_NAMES`; клиентский whitelist-тип `ActivationEventName`
  (`track.ts`) должен оставаться синхронным с этим массивом — рассинхрон ловится только в рантайме
  (400 `unknown activation event`), не в типах.

`resolveTier()` (`activation.ts`, web) — чистая функция без сетевого вызова: `home_tier !== "auto"`
берётся как есть, иначе выводится из `printers.length` (0–2 → `home`, 3+ → `farm`); `business`
достижим только явным PATCH, флоу его не выставляет.

## 4. Стейт-машина: узлы и переходы

Состояние `state ∈ {first_run, returning}` меняют ровно три писателя (перечислены в п.2
`docs/product/activation.md` — тут фиксируется только *откуда* технически идёт запись):

1. **Сервер, `loadActivation()`** — авто на `GET /me/activation`, если `sessions_seen ≥ RETURNING_AFTER_SESSIONS`
   (константа `= 5`, экспортируется из `activation.ts`).
2. **Клиент, `checklist.tsx`** — `useEffect` на `allDone`, шлёт `PATCH {first_run_completed: true}`.
3. **Клиент, `firstrun.tsx` (`PersonaCard`)** — кнопка «Пропустить», тот же PATCH.

`computeFirstRunStep()` — отдельная, не связанная с `state` последовательность внутри `first_run`:
`persona → printer_question → (picker | soft_track) → filament? → checklist`, выводится чистой
функцией из `primary_persona` + `home_dismissed_prompts.printer_answer` + `has_printer` + отметок
`dismissed.*`. `FirstRunFlow` рендерит ровно один шаг за раз и не хранит собственный React-стейт
шага — весь источник истины уже в объекте `activation`, поэтому шаг корректен сразу после reload.

`HomeScreen` — единственный компонент, монтирующий `FirstRunFlow`, и единственное место, где виден
переход `state` целиком (не отдельный шаг): здесь и только здесь логируются `home_view`,
`first_run_start`, `state_changed`.

## 5. Побочный писатель: inferred-персона

`useInferredPersona()` (`inferpersona.ts`) — `useEffect` на `[activation.activation, activation.printers]`
в `home.tsx`, безусловно вызывается в `HomeScreen` (не только в `returning`). Пишет
`PATCH {primary_persona, persona_source: "inferred"}` молча, без отдельного трекинг-события — сигнал
проявляется в порядке CTA/модулей дома, не в отдельной метрике воронки (см. комментарий в коде).
Условие применения — `shouldApplyInferredPersona()`: персона либо ещё `null`, либо уже была `inferred`
(never перезаписывает `declared`).

## 6. Точки расширения

- **Новый шаг чек-листа** — добавляется в `steps: StepDef[]` внутри `checklist.tsx` на нужную
  персональную ветку; хранится как булев ключ в `activation_checklist` (jsonb, без миграции схемы).
  Комментарий в коде явно фиксирует: границы шагов уже, чем в эпике MF-437, потому что часть
  разделов («выложи Make», «сравни принтеры», «привяжи выплаты») ещё не существует в web — шаг
  добавляется только когда есть реальная ссылка, не раньше.
- **Новая персона** — требует синхронной правки в трёх местах: `PERSONAS` (`activation.ts`, API),
  DB CHECK-констрейнт `user_activation_primary_persona_check` (новая миграция), `PERSONA_TILES`
  (`firstrun.tsx`, web) + любые персона-зависимые ветки в `checklist.tsx`/`inferpersona.ts`.
- **Новый шаг first-run флоу** — расширяет union `FirstRunStep` и ветку `switch` в `FirstRunFlow`;
  логика перехода добавляется в `computeFirstRunStep()` как чистая функция от `activation`, не как
  отдельный клиентский стейт.
- **Новое activation-событие** — добавляется в `ACTIVATION_EVENT_NAMES` (API, `events.ts`) +
  зеркальный `ActivationEventName` (web, `track.ts`) + миграция, расширяющая
  `events_event_name_check` (паттерн — `20260710140000_activation_events_taxonomy.sql`). Эмитится
  только через `POST /me/activation/events`, не напрямую через `emitEvent()` из продуктовых ручек —
  так происхождение событий воронки остаётся видимым (см. комментарий в `events.ts`).
- **`home_dismissed_prompts`** — свободная jsonb-карта гейтов «не показывать повторно»; новый
  одноразовый промпт/шаг добавляет свой ключ без миграции схемы, тем же паттерном, что уже
  использует `printer_answer` (единственный небулевый ключ, хранит `"yes"|"no"|"skip"`).

## 7. Известные расхождения / сознательные упрощения

- Нет `session_start`-эндпоинта: счётчик сессий инкрементируется на каждый `GET /me/activation` —
  грубая метрика, применяется намеренно (комментарий `loadActivation()`).
- `has_printer` не связана с переходом `state` напрямую — привязка принтера закрывает шаг чек-листа
  (путь №2 выше), а не третий отдельный триггер `returning`, хотя продуктовая гипотеза («ага»-действие)
  так формулируется в описании эпика. Зафиксировано и в `docs/product/activation.md` §2, здесь —
  как факт writer-контракта: единственные писатели `state = returning` — п.4.1 и п.4.2/4.3 выше.
