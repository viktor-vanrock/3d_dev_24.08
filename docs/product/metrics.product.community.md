# Метрики продукта (AARRR) и комьюнити (Reddit Visitors/Contributions)

**MF-732, Фаза 2 эпика MF-41 (см. [MF-430](../epics/analytics.events.md)).** Реализация —
`apps/api/src/analytics/metrics.product.ts` (Acquisition/Retention/Revenue/Referral) и
`apps/api/src/analytics/metrics.community.ts` (Visitors/Contributions/DAU-WAU-MAU/
contribution-ratio/ответность). Обе таблицы (`events`, схема) и таксономия — см.
[`analytics.events.md`](../epics/analytics.events.md); напоминание: реально эмитятся **6 из 11**
событий — `signup`, `first_search`, `model_view`, `model_download`, `upload_publish`,
`feed_vote`. `make_posted`/`purchase`/`payout_requested`/`feed_post`/`feed_comment` не эмитятся —
метрики ниже, которые от них зависят, **честно возвращают 0/пусто**, это не баг.

Sibling-карточка [MF-731](../epics/analytics.events.md) — метрики маркетплейса
(liquidity/match-rate/GMV) — отдельный файл/модуль, не дублируется здесь. Дашборд ([MF-733](.))
переиспользует эти же экспортируемые функции, а не копирует SQL.

## Продукт (AARRR)

### Acquisition — `acquisitionBySource(windowDays = 30)`

```sql
select coalesce(context->>'utm_source', 'unknown') as source, count(*) as signups
from events
where event_name = 'signup' and created_at >= now() - ($1::int * interval '1 day')
group by 1
order by signups desc;
```

**Открытый вопрос (не блокер, не в скоупе этой карточки):** `context` сейчас нигде не
заполняется вызывающим кодом — `auth/plagid.ts:99` и `auth/email.ts:150` эмитят `signup` без
`context` вообще (эмиттер поле поддерживает, `EmitEventParams.context` уже есть в
`analytics/events.ts`). Пока фронт/маркетинг не проставляют UTM в `context` на редиректе
логина, вся выдача схлопывается в `source = 'unknown'` — это ограничение эмиттера/фронта, не
самого запроса.

**Отдельный открытый вопрос:** метка канала миграции авторов (`props->>'migrated_from'`) —
такого поля в `props` события `signup` сейчас нет (см. `auth/plagid.ts`/`auth/email.ts`, `props`
несёт только `provider`). Не добавляем поле в рамках этой карточки — это решение по эмиттеру
(Back/Data), отдельная будущая карточка. Когда поле появится, сегментация — тот же паттерн:
`group by props->>'migrated_from'`.

### Retention D1/D7/D30 — `retention(windowDays: 1 | 7 | 30)`

```sql
with cohort as (
  select user_id, min(created_at) as signup_at
  from events
  where event_name = 'signup' and user_id is not null
  group by user_id
),
retained as (
  select c.user_id
  from cohort c
  join events e on e.user_id = c.user_id
    and e.created_at >= c.signup_at + ($1::int * interval '1 day')
  group by c.user_id
)
select (select count(*) from cohort) as cohort_size, (select count(*) from retained) as retained;
```

Когорта — юзеры с `signup` (событие всегда несёт `user_id`, эмитируется в момент создания
аккаунта — `user_id is not null` в запросе документирует инвариант, а не фильтрует реальные
строки). `retained` = у юзера есть **любое** событие на N-й день и позже от своего `signup` —
тот же грубый прокси retention, что уже задокументирован в `analytics.events.md` § «Метод
эмпирической валидации через когорту» для activation-гипотез (не read/write-разделение).

### Revenue — `revenue()`

```sql
select
  count(*) filter (where event_name = 'purchase') as purchases_count,
  coalesce(sum((props->>'amount')::numeric) filter (where event_name = 'purchase'), 0) as gmv,
  count(*) filter (where event_name = 'payout_requested') as payouts_count,
  coalesce(sum((props->>'amount')::numeric) filter (where event_name = 'payout_requested'), 0) as payouts_amount
from events
where event_name in ('purchase', 'payout_requested');
```

**Формула-заглушка** (не эмитятся нигде в `apps/api` — нет ручек покупок/выплат): GMV = сумма
`purchase.props.amount`; `payouts_amount` = сумма `payout_requested.props.amount`; net revenue =
`payouts_amount`; take-rate = net / GMV. `props->>'amount'` — предположение о будущей форме
`props`, не факт — финальная форма решается той ручкой, которая начнёт эмитить эти события (вне
скоупа MF-732). Запрос уже написан так, что заработает автоматически в день появления ручки —
трогать эмиттер не придётся.

### Referral — `referral(windowDays = 30)`

```sql
select count(*) as referral_actions
from events
where event_name = 'feed_post' and created_at >= now() - ($1::int * interval '1 day');
```

Ремиксы (MF-19) не реализованы, `feed_post`/шэров нет ни в продукте, ни в реально эмитящейся
таксономии — запрос всегда вернёт 0 сейчас. Формула-заглушка на будущее: `referral_rate =
(ремиксы + шэры, инициированные когортой) / cohort_size`. Осознанно не подменяем суррогатом
(например голосами) — это задвоило бы сигнал с contribution/response ниже, у которых уже есть
свой явный proxy.

## Комьюнити (модель Reddit 2025)

**Не member-count** — нигде в реализации нет `select count(*) from users`. Все метрики ниже
считаются от `events`, subject = `coalesce(user_id::text, anon_id)`.

**Известное ограничение subject-дедупликации:** один и тот же человек, замеченный анонимно ДО
логина и с `user_id` ПОСЛЕ, в текущих данных — два разных subject в рамках одного окна.
Identify-merge (`analytics.events.md` § «Identify-merge») намеренно не переписывает прошлые
строки задним числом, так что Visitors/DAU/MAU ниже слегка завышены для юзеров, залогинившихся
в первый раз внутри окна метрики — это know limitation дизайна событийки, а не баг агрегации
здесь.

### Visitors — `visitors(windowDays = 28)`

```sql
select count(distinct coalesce(user_id::text, anon_id)) as visitors
from events
where created_at >= now() - ($1::int * interval '1 day');
```

Любое событие сайта в целом (не только лента — отдельного продукта-ленты ещё нет), скользящее
окно 28 дней, лёркеры включены.

### Contributions — `contributions(windowDays = 7)`

```sql
select
  count(*) as contributions,
  count(distinct coalesce(user_id::text, anon_id)) as contributors
from events
where event_name in ('upload_publish', 'feed_vote')
  and created_at >= now() - ($1::int * interval '1 day');
```

**Proxy, явно задокументировано:** `feed_vote` (голос за модель, `models/vote.ts`) — ближайший
реальный аналог «поста/коммента» до появления `feed_post`/`feed_comment` с HTTP-ручками
(`analytics/events.ts` комментарий). Когда лента появится, `event_name in (...)` расширяется на
`feed_post`/`feed_comment`, сигнатура функции не меняется.

### DAU/WAU/MAU + stickiness — `dauWauMau()`

```sql
select
  count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '1 day') as dau,
  count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '7 days') as wau,
  count(distinct coalesce(user_id::text, anon_id)) filter (where created_at >= now() - interval '30 days') as mau
from events
where created_at >= now() - interval '30 days';
```

Любое событие (не только фида). `stickiness_pct = dau / mau * 100` (0, если `mau = 0`).

### Contribution-ratio — `contributionRatio(windowDays = 28)`

```sql
with in_window as (
  select coalesce(user_id::text, anon_id) as subject, event_name
  from events
  where created_at >= now() - ($1::int * interval '1 day')
)
select
  count(distinct subject) as visitors,
  count(distinct subject) filter (where event_name in ('upload_publish', 'feed_vote')) as contributors
from in_window;
```

Доля контрибьюторов среди Visitors **того же окна** — лёркеры (Visitors без ни одного
contribution-события) остаются в знаменателе, не исключаются (карточка MF-732 явно требует их
считать).

### Ответность — `responseRate()`

```sql
with voted_models as (
  select distinct (props->>'model_id')::uuid as model_id
  from events
  where event_name = 'feed_vote' and props->>'model_id' is not null
)
select
  (select count(*) from models where status = 'ready') as total_models,
  (select count(*) from models m join voted_models v on v.model_id = m.id where m.status = 'ready')
    as models_with_response;
```

**Proxy, явно задокументировано:** доля постов с ≥1 ответом → доля опубликованных
(`status = 'ready'`) моделей с ≥1 `feed_vote` (голос вместо ответа/коммента — `feed_comment` не
эмитится). `model_id` резолвится из `events.props->>'model_id'`, который `feed_vote` кладёт
всегда (`models/vote.ts`).

## Статистика по максимуму — per-object инструментирование (сверка CTO, MF-864, 2026-07-10)

Роадмап (§ «Сквозные направления и акценты») требует «статистику по максимуму»: какие принтеры у
юзеров, что качают, топ-страницы, лайки/дизы, воронки — как сквозной инструмент на каждой фиче,
не отдельный экран. Разделы выше (AARRR + комьюнити) уже дают воронку/DAU/ответность; явно
дозакладываю три конкретных среза, которые видение называет по имени, а действующая событийка
(MF-429, Фаза 1 done) их не перечисляет как обязательные — Фаза 2 MF-430 (in_progress) обязана
покрыть их, не только три уже названных в её описании блока (liquidity, AARRR, дашборд):

- **Какие принтеры/филаменты у юзеров** — это НЕ событие, это агрегат по `user_printers`/
  `user_machines` (см. «Статистика владения», [domain.model.md](../epics/domain.model.md)):
  топ моделей по числу заявленных/подтверждённых владельцев, распределение по вендорам. Запрос по
  уже существующей таблице, отдельного трекинга не требует — дозакладка здесь чисто в том, что
  дашборд MF-430 обязан вывести этот срез явным блоком «Парк пользователей», а не только считать
  его в фоновых SQL.
- **Топ-страницы** — сегодня в таксономии MF-429 нет универсального `page_view`/`screen_view`
  события (есть точечные `home_view`, `model_view` и т.п., но не сквозной счётчик по каждому
  роуту). Без него нельзя посчитать «самые посещаемые страницы» буквально. Добавить в Фазу 2:
  лёгкий `page_view {path}` эмиттер на смене роута (`router.ts`, один общий хук, не точечные
  события на каждый экран) + агрегирующий запрос `count(*) group by props->>'path'`.
- **Лайки/дизы по объектам** — уже есть как факт (`votes`/`idea_votes`/`model_votes`,
  `feed_vote`-событие), но не агрегированы в дашборде как отдельный срез «топ по голосам за N
  дней» по каждому типу объекта (модель/тред/пост/идея) — сегодня дашборд считает только
  агрегаты по контурам (AARRR/комьюнити), не рейтинг конкретных объектов. Добавить блок «Топ по
  голосам» — `group by subject_type, subject_id order by votes_up - votes_down desc`.

Это дозакладка детали в спеку, не новая карточка — Data/Fullstack закрывают в рамках уже
назначенной и идущей MF-430 (Фаза 2 MF-41), не отдельным треком.

## Проверено на dev-БД (2026-07-10)

Прогнано на `portal_dev` (dev.3mf.tech) — `docker exec portalru-postgres-1 psql -U portal_dev -d
portal_dev`. Продукт живёт с 2026-07-09, `events` пока почти пустая: **1 строка**
(`first_search`, 0 `signup`/`model_view`/…) — тот же факт, что уже зафиксирован в
`analytics.events.md` § «Метод эмпирической валидации через когорту» («выборка статистически
пустая, гонять запрос рано»). Значит все метрики ниже сейчас честно возвращают 0/пусто по
объёму данных, а не по ошибке запроса — цель этого прогона показать, что каждый запрос
**выполняется без ошибок и использует индекс**, не что цифры уже интересные.

| Метрика | Результат | План |
|---|---|---|
| `acquisitionBySource(30)` | `[]` (0 signup) | `Index Scan using events_name_ts_idx` |
| `retention(7)` | `cohort_size=0, retained=0` | cohort: `Bitmap Index Scan events_name_ts_idx`; join: `Seq Scan` (пусто, таблица `events` — 1 строка, ожидаемо на текущем объёме) |
| `revenue()` | все поля `0` | `Seq Scan on events` (нет строк `purchase`/`payout_requested`, планировщик не выбрал индекс — таблица из 1 строки) |
| `referral(30)` | `referral_actions=0` | `Index Only Scan using events_name_ts_idx` |
| `visitors(28)` | `1` (единственная строка `first_search`) | `Seq Scan` + `Sort` (нет индекса по голому `created_at` — см. «Дальше» ниже) |
| `contributions(7)` | `contributions=0, contributors=0` | `Index Scan using events_name_ts_idx` |
| `dauWauMau()` | `dau=0, wau=0, mau=1, stickiness_pct=0` | `Seq Scan` (диапазон `created_at`) |
| `contributionRatio(28)` | `visitors=1, contributors=0, ratio_pct=0` | `Seq Scan` + `Sort` |
| `responseRate()` | `total_models=0, models_with_response=0` | `Seq Scan on models` (каталог тоже пуст на dev) |

Полные EXPLAIN ANALYZE каждого запроса — вывод команд в этом прогоне, не пересказ (лог сохранён
у исполнителя карточки MF-732). Ключевой вывод: запросы с `event_name` в `where` (acquisition,
referral, retention-cohort, contributions) используют `events_name_ts_idx`, как и предполагает
схема (`analytics.events.md` § «Схема события»). Запросы без `event_name`-фильтра (visitors,
DAU/WAU/MAU, contribution-ratio) делают `Seq Scan` по диапазону `created_at` — на 1 строке это
не имеет значения, но это тот же паттерн, о котором уже предупреждает `analytics.events.md` §
«Хранилище и порог ClickHouse»: «воронки/когорты по индексу `event_name`+`created_at` уже
дорогие на десятках миллионов строк» — добавлять отдельный индекс по голому `created_at` не в
скоупе этой карточки (схема — зона Data) и преждевременно на текущем объёме (~1 событие).

## Главная после чистки (MF-802, рамка `docs/design/frame.md` §1, канон MF-789)

MF-789 срезает с `/` `ContinueCard`/`CompatModule`/`PersonaCtaRow`/`ActivationChecklist`, оставляя
ровно два блока: hero-строку ввода (нейропоиск + генератор Kandinsky 3D) и подборки «что
напечатать». Ставка оператора: меньше выбора на экране → быстрее до результата. Ниже — как это
проверяется, а не принимается на веру. Не дублирует § «Activation-гипотезы» `analytics.events.md`
(та секция — про 7/14-дневные когорты от `signup`, эта — про то, что происходит **внутри одной
сессии на `/`**, короткое окно, не когортное).

### 1. «Работает» = `home_to_download_rate`

```
home_to_download_rate = home_view_sessions_with_download_30m / home_view_sessions
```

**Session** — не login-сессия, а окно 30 минут от `home_view` того же subject
(`coalesce(user_id::text, anon_id)`) — тот же приём, что уже задокументирован в
`metrics.marketplace.md` § 2 (`search_to_download_match_rate`, тоже 30 минут по той же причине:
нет прямой ссылки «этот download — результат именно этого захода», окно — прокси одной сессии
просмотра). `home_view_sessions` — количество `home_view` (дедуп: несколько `home_view` от
одного subject внутри одного 30-минутного окна считаются одной сессией, не задваиваются).
`..._with_download` — из них те, где в окне встретился `model_download` **или**
`generation_download` (см. § 3) — «нашёл/сгенерил → скачал» из карточки MF-802 буквально одна
метрика результата, не две параллельных.

**Guardrail (не второй «успех», а ранний сигнал той же гипотезы):**

```
home_bounce_rate = home_view_sessions_with_zero_engagement / home_view_sessions
```

`_with_zero_engagement` — сессии без `home_hero_submit` и без `gallery_tile_click` вообще (см. §
3) — то есть человек зашёл и ничего не тронул. Ловит регресс на первом шаге воронки раньше, чем
накопится достаточно данных на конверсию до скачивания (у конверсии в знаменателе меньше строк).

**Базлайн:** сегодня (2026-07-10) не измерен — ни `home_view`, ни `generation_download` ещё не
существуют как события, а старый дом никогда не был проинструментирован на этот вопрос. Честная
позиция: у нас нет числа «было», с которым сравнивать «стало» — это ограничение, не то, что можно
обойти задним числом. Рекомендация Front/Lead (не блокирует эту карточку): если Front успевает
повесить `home_view`/`gallery_tile_click`/`home_hero_submit` НА ТЕКУЩЕМ доме хотя бы на несколько
дней до выката чистки (MF-806), появится честный «было». Если чистка и события едут одним пушем
(вероятный сценарий по срокам эпика) — базлайном становится первое 14-дневное окно ПОСЛЕ выката,
следующее 14-дневное окно сравнивается с ним же (метрика сравнивается сама с собой во времени,
не с гипотетическим «до»).

### 2. Воронка

```
home_view
 ├─ gallery_tile_click (тап карточки подборки) ──► model_view (уже эмитится, models/detail.ts)
 │                                                    └─► model_download (уже эмитится, models/download.ts)
 └─ home_hint_chip_click (тап чипа, необязательный шаг) ─┐
                                                          ▼
                                                  home_hero_submit (тап искры/send)
                                                          ├─ (нашли что искали) → first_search (уже эмитится, models/list.ts) → model_view → model_download
                                                          └─ (генерируем)       → generation_start → generation_outcome(status) → generation_download
```

Точки отвала, за которыми следим (не абстрактно «воронка», а где именно ждём проблему после
чистки):

1. **`home_view` → ничего** (`home_bounce_rate` выше) — главный риск минимализма: не увидел, что
   делать, и ушёл. Если вырастет после чистки — первый кандидат «рамка слишком спартанская».
2. **`gallery_tile_click` → `model_download`** — открыл модель, не скачал. Раньше рядом была
   подсказка совместимости (`CompatModule`); без неё разрыв может вырасти — сверять с § 4.
3. **`home_hero_submit` → `generation_outcome`** — ввёл промпт и не дождался/ушёл, либо генератор
   ошибся (`status: 'error'`, отдельно от ухода пользователя, см. § 3 `error_code`).
4. **`generation_outcome(done)` → `generation_download`** — сгенерировал, не скачал (результат не
   понравился, или «Скачать» недостаточно заметно рядом с превью — вопрос к Design/Front, не к
   формуле метрики).

### 3. События — контракт для Front

Всё через уже существующий канал `POST /me/activation/events` (`apps/web/src/home/track.ts`,
`apps/api/src/profile/activation.ts`) и его константу `ACTIVATION_EVENT_NAMES`
(`apps/api/src/analytics/events.ts`) — **не заводим новый транспорт**, тот же fail-soft/consent-
гейт/identify-merge, что и у 12 уже там живущих событий. Добавление имён — та же миграция
`events_event_name_check`, что уже расширяла таксономию раньше (`analytics.events.md` §
«Таксономия»), делает Data/Back.

| Событие | Свойства (`props`) | Когда шлём | Где в коде (ориентир для Front) |
|---|---|---|---|
| `home_view` | `{ state: 'first_run' \| 'returning' }` | Маунт `HomeScreen`, один раз на заход (тот же паттерн, что уже есть `firstRunStartLogged`/`previousStateRef` в `home.tsx`, не дублировать логику, дописать рядом) | `apps/web/src/home/home.tsx` |
| `home_hint_chip_click` | `{ text }` | Тап по чипу-подсказке (`SEARCH_HINTS`) | `apps/web/src/home/home.tsx`, `onClick={() => setQuery(hint.text)}` |
| `home_hero_submit` | `{ query_length }` (не кладём сырой промпт в activation-канал — `first_search`/`model_view`/`model_download` ниже по воронке уже несут `model_id`/`query` там, где это принято, здесь достаточно длины) | Тап send/искра с непустым промптом, ДО ответа сервера — сам факт попытки, не результат | `apps/web/src/home/home.tsx`, `NeuroSearch.handleSend()` |
| `nav_item_click` | `{ item: 'home' \| 'feed' \| 'printers' \| 'project' }` | Клик по любому из 4 пунктов закреплённого меню (реестр один — `NAV_ITEMS`, событие тоже одно на все 4, не 4 отдельных) | `apps/web/src/home/navitems.ts`/шапка (MF-804, куда переедет рендер пунктов) |
| `gallery_tile_click` | `{ model_id, position, collection: 'popular' }` | Тап карточки в подборке дома, до навигации | `apps/web/src/home/modeltile.tsx` (`ModelTileButton.onOpen`, уже есть колбэк-точка) / `home.tsx` `PopularGallery` |
| `generation_outcome` | `{ generation_id, branch, status: 'done' \| 'error', error_code }` | Клиент уже поллит `GET /generations/:id` (`apps/web/src/generate/generatescreen.tsx`) — на первое наблюдение `done`/`error` шлём один раз (гвардить рефом, как `firstRunStartLogged`, не на каждый тик поллинга) | `apps/web/src/generate/generatescreen.tsx` |

Плюс два **серверных** события — расширяют основной `EVENT_NAMES` (не `ACTIVATION_EVENT_NAMES`:
это события продукта уровня `model_view`/`model_download`, не воронки активации нового юзера),
эмитятся тем же `emitEvent()`, тот же паттерн, что уже в этих файлах:

| Событие | Свойства | Когда | Где |
|---|---|---|---|
| `generation_start` | `{ generation_id, branch }` | `POST /generations` успешно создал job | `apps/api/src/generations/create.ts`, рядом со `returning id, ...` |
| `generation_download` | `{ generation_id, branch }` | Отдача `artifact_url` (`GET /generations/:id/artifact`) | `apps/api/src/generations/asset.ts`, тот же паттерн, что `model_download` в `models/download.ts` |

`generation_start`/`generation_download` на бэке, а не клиентом — тот же довод, что уже есть у
`model_view`/`model_download`: сервер видит факт достоверно (клиентский клик до навигации можно
потерять на медленной сети), клиенту остаётся то, что сервер в принципе не видит (`home_view`,
тапы, наблюдение статуса поллингом).

### 4. Контроль регрессии — что теряем, убирая модули

`ContinueCard`/`CompatModule` не удаляются as a concept — переезжают в ЛК/раздел «Принтеры»
(`frame.md` §1). Два сигнала на случай, если функция была нужна именно на главной:

- **`printer_linked` (уже эмитится, `printerpicker.tsx`)** — недельная частота. Просадка после
  выката чистки против недели до = `CompatModule` вправду подталкивал линковку принтера с
  главной, а в новом месте (`/printers`) это происходит реже. Новых событий не требует — просто
  смотреть существующий ряд по неделям вокруг даты выката.
- **`profile_view`** (новое, минимальный однострочный event, тот же канал `ACTIVATION_EVENT_NAMES`)
  — маунт ЛК/профиля, без свойств. Сигнал регресса `ContinueCard`: всплеск `home_view` →
  `profile_view` **в течение <30 секунд, без `gallery_tile_click`/`home_hero_submit` между ними**
  — то есть зашёл на дом и сразу молча ушёл искать «продолжить» в профиле, не тронув ничего
  нового. Разовый скачок в первую неделю после выката — ожидаемо (люди ищут привычную кнопку);
  устойчивый повышенный уровень через 2+ недели — сигнал возвращаться к CTO.

### 5. Абьюз/накрутка

- **Соотношение, не сырой счётчик** — `home_to_download_rate`/`home_bounce_rate` обе доли, спам
  `home_view`/`gallery_tile_click` без реальных скачиваний **портит** метрику вниз, а не рисует
  успех вверх — накручивать в свою пользу нечем, разве что реальными скачиваниями.
  - Дедуп session-window (§1) не даёт раздуть знаменатель повторными `home_view` одного subject
    внутри 30 минут (переоткрыл вкладку, обновил страницу — одна сессия, не пять).
- **Скачивания уже рейт-лимитированы** (`enforceRateLimit(request, reply, "download", session.id)`,
  `models/download.ts`) — тот же лимит защищает и `generation_download`, если Back применит его
  симметрично к `/generations/:id/artifact` (сверить при реализации, не факт что уже стоит там —
  это открытый вопрос к Back/Fullstack, не блокер этой карточки).
- **`generation_start` без завершения** («накрутить» видимость активности повторными пустыми
  сабмитами) не помогает числителю `home_to_download_rate` — считается только фактическое
  `generation_download`, промежуточные шаги видны только в воронке (§2), не в метрике успеха.

### 6. Порог решения

Без исторического «было» (см. § 1 «Базлайн») числа ниже — **явно провизорный порог**, не
откалиброванный ряд: первая же реальная 2-недельная когорта (≥50 `home_view`/неделя — до этого
объёма делать вывод рано, продукт живёт с 2026-07-09 и на момент этой карточки в `events` меньше
десятка строк) переоценивается и фиксируется как настоящий базлайн в комментарии карточки анализа
(создаётся ниже).

- ✅ **рамка верна** — `home_to_download_rate ≥ 15%` две недели подряд (≥50 `home_view`/нед. в
  каждой) и `printer_linked`/нед. не просело >20% против недели до выката → закрываем вопрос,
  дальше просто мониторим в общем дашборде метрик (MF-733).
- 🔁 **на грани** — данных мало (`home_view`/нед. < 50 обе недели) → не вердикт, а «ждём трафика»,
  сдвигаем контрольную точку ещё на 2 недели, не притворяемся, что цифра значима.
- ⛔ **возвращаемся к CTO** — `home_to_download_rate < 5%` **или** `home_bounce_rate` растёт
  неделя к неделе два раза подряд при достаточном объёме → минимализм перегнул, часть удалённых
  модулей (скорее всего `CompatModule`, судя по § 4) нужна была на самой главной, не только по
  адресу «переехало».

**Контрольная точка:** первая проверка — через 14 дней после того, как `home_view` начнёт реально
писаться на 3mf.tech (не через 14 дней от этой карточки — от факта выката инструментирования).
Заведена карточка анализа на Growth с датой снятия — см. финальный коммент MF-802.

## Тесты

`apps/api/src/analytics/metrics.product.test.ts`, `apps/api/src/analytics/metrics.community.test.ts`
— вставляют события напрямую в `events` (минуя consent-гейт эмиттера, он уже покрыт
`events.test.ts`) и проверяют формулы: acquisition группирует по `utm_source`/`unknown`,
retention считает только события на/после N-го дня, revenue/referral возвращают честный ноль,
visitors не задваивает один subject, contribution-ratio держит лёркеров в знаменателе,
response-rate считает proxy по `feed_vote`. `pnpm --filter @portal/api test` — зелёный (296
passed из уже существующих + 9 новых; 7 unrelated failures в `auth/crypto`/`printers/
prusaConnect.sync` — требуют `AUTH_ENCRYPTION_KEY`, не тронуто этой карточкой).
