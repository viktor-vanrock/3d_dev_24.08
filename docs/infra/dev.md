# dev.3mf.tech — временная dev-среда на VDS

> **Суть — временная мера** (эпик [MF-532](mention://issue/fb2b1dcf-7bd3-4d2c-ae35-9d3fe934f114),
> авторизация оператора 07.07). Второй инстанс портала на той же VDS, для живого UI-ревью и
> отбора данных агентами — без прод-доступа. Владелец доки — Ops (решение Lead). Устареет, когда
> (а) прод получит нормальные превью (MF-469) и (б) появится настоящий staging (v2,
> `architecture.md`) — тогда среда либо станет штатным staging, либо будет потушена по разделу
> «Как потушить» ниже.
>
> **Важно:** механика «как зайти» ниже — **актуальная на 11.07**, она разошлась с изначальным
> планом эпика (`AUTH_DEV_BYPASS`/`POST /auth/dev`) после директивы оператора о закрытой разработке
> ([MF-1032](mention://issue/68257029-2b1d-48f7-ada7-8f87cef2e031), `docs/product/access.policy.md`).
> Читай именно этот файл, а не описание в теле эпика MF-532.

## Как устроено

Второй инстанс на том же VDS, что и прод (`infra.md`), изолированный от него по коду, БД, сети,
секретам:

| | dev | прод (для сравнения) |
|---|---|---|
| web | `dev.3mf.tech` | `3mf.tech` |
| api | `api.dev.3mf.tech` (nginx → `127.0.0.1:3200`) | `api.3mf.tech` |
| relay | compiled `@portal/relay`: `relay.dev.3mf.tech` → mTLS WSS `127.0.0.1:3011`; loopback observability `127.0.0.1:3012` | `relay.3mf.tech` with separate gateway/observability listeners |
| код | `~/portal.ru-dev` (свой чекаут, ветка `dev`) | `~/portal.ru` (`main`) |
| БД | `portal_dev` (тот же PostgreSQL 16, отдельная роль, права только на `portal_dev`) | `portal` |
| бакет | `3mf-dev` | `3mf` |
| env-файлы | `~/portal.api-dev.env`, `~/portal.mesh-dev.env`, `~/portal.relay-dev.env` (chmod 600, не в git) | `~/portal.api.env` и т.д. |
| автодеплой | `portal.deploy-dev.timer` → `portal.deploy-dev.service` (раз в минуту, poll `origin/dev`, `deploy/portal.deploy-dev.sh`) | `portal.deploy.timer` (poll `main`) |
| api-процесс | `portal.api-dev.service` | `portal.api.service` |
| mesh-воркер | `portal.mesh-worker-dev.service` | `portal.mesh-worker.service` |

`JWT_SECRET`, `AUTH_ENCRYPTION_KEY`, `AUTH_HMAC_KEY`, `COOKIE_DOMAIN=.dev.3mf.tech` — свои, не
совпадают с прод. Изоляция инвариант: dev никогда не пишет в прод-БД/прод-бакет (см. `dev.seed.md`
ниже, гейт зашит в сид-скрипте, а не только в доке).

nginx: `deploy/nginx.dev.3mf.tech.conf` — SPA с `try_files … /index.html` (значит `/project`
прямым заходом открывается, не 404), плюс dev-специфика: kill-switch service worker'а
(`/sw.js` → `dev-sw-kill.js`, чтобы кеш не залипал на постоянно меняющемся dev), и same-origin
Umami-трекер на `/_a/`.

## Как зайти

**Обычный агент (webcheck) — ничего делать не нужно.** `webcheck <url>` (скилл `autofab-webtest`)
сам подставляет служебную cookie `portal_session` из `~/.autofab-session-dev` для любого хоста
`*.dev.3mf.tech` и `~/.autofab-session` для `*.3mf.tech` — разные файлы, потому что у сред разные
`JWT_SECRET` (см. `.env.example`). Сессия живёт под фиксированным служебным юзером
`autofab-agent` (обычная роль, НЕ admin), заведена заранее и живёт ~год — просто:

```bash
webcheck https://dev.3mf.tech/project
```

и получаешь скриншот+DOM уже залогиненным. Это и есть «dev-вход» для 99% задач ревью/отбора.

**curl / скрипты без браузера** — тот же cookie руками:

```bash
TOKEN=$(cat ~/.autofab-session-dev)
curl -H "Cookie: portal_session=$TOKEN" https://api.dev.3mf.tech/models
```

Файл `~/.autofab-session-dev` читают только Ops-скрипты и агенты этого VDS (chmod 600); значение
токена никогда не публикуется в карточки/логи. Пересоздать (если протух/ротировали
`JWT_SECRET`): `/usr/local/bin/autofab-session-refresh` (Ops).

**Почему НЕ `POST /auth/dev` / `AUTH_DEV_BYPASS`.** Изначальный план эпика MF-532 — публичный
dev-вход через `POST /auth/dev` с флагом `AUTH_DEV_BYPASS=1`, юзер `devuser` (он же admin,
`ADMIN_USERNAMES=devuser`). После директивы закрытой разработки (MF-1032, 11.07) этот путь
**выключен на живом VDS** — `AUTH_DEV_BYPASS` закомментирован в `~/portal.api-dev.env`, эндпоинт
отдаёт `404`, проверено:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.dev.3mf.tech/auth/dev   # 404, не 200
```

Плюс сам гейт закрытой разработки: без cookie-сессии api отдаёт только `/health` и `/auth/*`
(`401`/редирект на LoginPage на всём остальном — `CLOSED_DEV=1`, зеркально прод, политика
`docs/product/access.policy.md`). `deploy/portal.dev.api.env.example` в репо ещё показывает
старую схему (`AUTH_DEV_BYPASS=1`) — это шаблон-заготовка, не описание живого VDS; актуальна
таблица выше и этот раздел.

**Admin-вход как `devuser`** (для живой перепометки featured на dev через admin-путь, как
задумано в «Итогах совета» MF-532) сейчас **не самообслуживание** — `autofab-agent` не в
admin-allowlist. Нужен admin-сеанс на dev — попроси Ops, доступ выдаётся точечно, не публичным
эндпоинтом.

## Как засидить

*(раздел от Data, эпик MF-532, `dev.seed.md` в этом же каталоге — воспроизведён целиком)*

Сид наполняет dev-среду (`dev.3mf.tech`) данными каталога/hero, чтобы ревью шло по живому UI,
а не по пустым экранам. Живёт в репо и гоняется по требованию — при рассинхроне со схемой после
миграций просто пере-сеивается (владение — Data).

**Что кладёт (слой 1 — синтетика):** 4 dev-юзера (включая `devuser`), 20 моделей `status='ready'`
разных форматов, у каждой `preview.glb` (один из 6 GLB-примитивов) и `role='thumbnail'` webp,
5 моделей помечены `featured`. Объекты — в бакете `3mf-dev`. Фикстуры детерминированные, в репо
(`apps/api/scripts/fixtures/*.glb`, `*.webp`).

**Слой 2 (hero-копия реальных прод-моделей) снят с критического пути** — на 08.07 на проде было
всего 3 ready-модели с preview (порог был 6), fast-path невозможен; заводится отдельным прогоном,
когда прод-пул дорастёт. **На 11.07 прод дал больше моделей — см. раздел «Синхронность hero-пула»
ниже, там актуальная проверка порога и текущий статус.**

```bash
# env dev-инстанса (~/portal.dev.api.env): DATABASE_URL на portal_dev, S3_* на бакет 3mf-dev,
# S3_BUCKET_MODELS=3mf-dev, NODE_ENV=development
pnpm --filter @portal/api seed:dev
```

Флаги: `--no-migrate` (не гонять `migrate()` первым шагом), `--skip-assets` (только строки в БД,
без заливки объектов).

Скрипт **идемпотентен** — повторный запуск досеивает/обновляет по детерминированным UUID.

**Предохранители (почему не тронет прод):** падает до любой записи, если `NODE_ENV=production`,
или имя БД — `portal` (безусловный денилист), или имя БД ≠ `portal_dev` (переопределяется
`SEED_DB_NAME`, но `portal` запрещён всегда), или нет `DATABASE_URL`. Заливка ассетов — только
в бакет из `S3_BUCKET_MODELS` (на dev `3mf-dev`), в прод-бакет `3mf` сид не пишет.

## Как проверить (смоук)

`scripts/dev-smoke.sh` перебрасывает шаг 2 на cookie-based вход (MF-1095): читает
`portal_session` из `~/.autofab-session-dev` (тот же токен, что использует `webcheck`) вместо
`POST /auth/dev`, который после MF-1032 отдаёт `404`. Просто `scripts/dev-smoke.sh` без ручных
шагов. Ручной сценарий ниже — для точечной диагностики того же пути:

```bash
TOKEN=$(cat ~/.autofab-session-dev)
API=https://api.dev.3mf.tech
WEB=https://dev.3mf.tech

curl -s -o /dev/null -w 'health: %{http_code}\n' "$API/health"                                    # 200
curl -s -H "Cookie: portal_session=$TOKEN" "$API/auth/session" | grep -o '"username":"[^"]*"'      # autofab-agent
curl -s -o /dev/null -w 'models: %{http_code}\n' -H "Cookie: portal_session=$TOKEN" "$API/models"   # 200
curl -s -o /dev/null -w 'guest models (должен быть закрыт): %{http_code}\n' "$API/models"           # 401
curl -s -w '\nproject: %{http_code}\n' "$WEB/project" | tail -1                                     # 200 (SPA-фолбэк)
```

Или то же самое одной командой глазами: `webcheck https://dev.3mf.tech/project` — смотри
`screen.png`/`text.txt` в выводе, каталог и hero-карусель не должны быть пустыми (см. сид выше).

Проверка сида/каталога (после `seed:dev`):

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' ~/portal.api-dev.env | cut -d= -f2-)
psql "$DATABASE_URL" -c "select count(*) from models where status='ready'"          # 20
psql "$DATABASE_URL" -c "select count(*) from models where featured_at is not null"  # 5 (после сида)
```

## Синхронность hero-пула с продом

Featured-набор на dev — синтетика Data (5 моделей из фикстур), не копия прод-данных: слой 2
(read-only копия реальных прод-featured в `3mf-dev`) снят с критического пути эпика и не заведён.
На 11.07 `GET /models?featured=1` на dev возвращает `0` (сид без `featured=1` ещё не гонялся на
этом стенде / пере-сид нужен) — **если тебе нужно «hero на dev = hero на проде», это НЕ так по
умолчанию**, проверяй перед тем как полагаться:

```bash
TOKEN_DEV=$(cat ~/.autofab-session-dev); TOKEN_PROD=$(cat ~/.autofab-session)
curl -s -H "Cookie: portal_session=$TOKEN_DEV"  "https://api.dev.3mf.tech/models?featured=1" | grep -o '"id"' | wc -l
curl -s -H "Cookie: portal_session=$TOKEN_PROD" "https://api.3mf.tech/models?featured=1"     | grep -o '"id"' | wc -l
```

Если числа/id не совпадают — это ожидаемо (см. выше), не баг среды. Синхронизация — ручной прогон
слоя 2 сида, когда он понадобится (владение Data), не автоматика.

## Как перезапустить

```bash
sudo systemctl restart portal.api-dev.service           # после ручного изменения env
sudo systemctl restart portal.mesh-worker-dev.service
# relay обычно собирает/restarts deploy/portal.deploy-dev.sh; ручной путь:
pnpm run check:relay-deploy && pnpm run build:relay
sudo systemctl restart portal.relay-dev.service
sudo systemctl status portal.api-dev.service portal.mesh-worker-dev.service portal.relay-dev.service
journalctl -u portal.relay-dev -n 100 --no-pager
curl -fsS http://127.0.0.1:3012/ready                    # observability, не gateway WSS
journalctl -u portal.api-dev -f                          # логи api при отладке
```

Код обычно приезжает сам — автодеплой (`portal.deploy-dev.timer`) раз в минуту тянет `origin/dev`,
билдит и рестартует `portal.api-dev` при изменениях. Ручной restart нужен только после правки
env-файла руками (автодеплой его не трогает) или при зависшем процессе.

Проверить, что автодеплой жив: `systemctl list-timers portal.deploy-dev.timer`.

## Итоговое правило дедупликации `answer_accepted` (MF-1260, MF-1573, MF-1621–MF-1623)

Этот раздел фиксирует итоговое решение по инциденту MF-1461 в контуре родителя MF-1607 и
направления MF-1573. Реализация находится в
`apps/api/db/migrations/20260713000000_accept_reputation_idempotency.sql`; миграция не меняет
API, S3, systemd или пользовательский контракт. Ошибка `23505` при создании
`reputation_events_answer_accept_once_idx` была следствием исторических повторов accept, а не
необходимостью отключить уникальность.

Решение проверено по материалам MF-1616–MF-1620, fixture и регрессионным тестам MF-1622.
Ниже разделены доказанные факты схемы/кода и вывод о том, какую строку считать техническим
дублем.

### Что именно является дублем

`reputation_events` задаётся в
`apps/api/db/migrations/20260709010859_community_foundation.sql`: история хранит
`(id, user_id, points, reason, subject_type, subject_id, created_at)`, а `subject_id` намеренно
не имеет FK, чтобы удалённый субъект не стирал историю. Миграция
`apps/api/db/migrations/20260713000000_accept_reputation_idempotency.sql` защищает не всю строку,
а частичный ключ:

```sql
unique (user_id, subject_id) where reason = 'answer_accepted'
```

Поэтому точное нарушение — две или более строки с одинаковыми `reason='answer_accepted'`,
`user_id` и `subject_id`; `subject_type` в ключ не входит. Для обычного accept это автор ответа
(`user_id`) + UUID поста-ответа (`subject_id`, `subject_type='post'`).

Источник появления установлен по истории кода:

1. До `07483d4` обработчик `accept.ts` после каждого непустого accept вызывал
   `awardAcceptedAnswer`, а `reputation.ts` без проверки вставлял новый reward event. Повторный
   клик, HTTP-ретрай или повторная доставка запроса давали ещё одну строку и ещё один `+15`.
2. `07483d4` добавил транзакционную проверку. Последующая миграция очистки и индекса была
   усилена сериализацией блокировок (`ea52e2f`, `93c9024`) и пересозданием одноимённого индекса
   (`ed741aa`), потому что одного `if not exists` недостаточно для гарантии уникальности.
   На проблемном SHA кодовый guard уже был, но старые строки в базе никуда не исчезли; именно
   они объясняют падение индекса при deploy.

### Лестница выбора сохраняемой записи

Для каждой группы с одинаковыми `(user_id, subject_id)` среди `reason='answer_accepted'`:

1. сохраняется строка с минимальным `created_at`;
2. при одинаковом времени сохраняется строка с минимальным `id`;
3. все строки с рангом `rn > 1` считаются техническими ретраями и удаляются.

Это не попытка восстановить бизнес-хронологию по внешнему субъекту: `subject_id` намеренно не
имеет FK и может указывать на уже удалённый пост. При одинаковых технических полях миграция
использует только детерминированный tie-break по UUID `id`.

Запрещено удалять:

- каноническую строку `rn=1`;
- события с `reason`, отличным от `answer_accepted`;
- события другой пары `(user_id, subject_id)`;
- строки `users` или события, не попавшие в `duplicates`.

`subject_type` не входит в частичный индекс и потому не может отменить дубль: одинаковая пара
`(user_id, subject_id)` при `reason='answer_accepted'` конфликтует даже при различном
`subject_type`. Для штатного accept это автор ответа и UUID поста (`subject_type='post'`).

### SQL-evidence

На проблемной базе сначала выполнить read-only запрос. Он группирует ровно по ключу будущего
индекса и показывает кандидата на канон (`rn=1`) и строки, которые миграция считает ретраями
(`rn>1`):

```sql
with ranked as (
  select id, user_id, points, reason, subject_type, subject_id, created_at,
         row_number() over (
           partition by user_id, subject_id
           order by created_at asc, id asc
         ) as rn
  from reputation_events
  where reason = 'answer_accepted'
)
select id, user_id, points, reason, subject_type, subject_id, created_at, rn,
       case when rn = 1 then 'canonical' else 'duplicate_retry' end as classification
from ranked
where exists (
  select 1
  from ranked duplicate_key
  where duplicate_key.user_id = ranked.user_id
    and duplicate_key.subject_id = ranked.subject_id
  group by duplicate_key.user_id, duplicate_key.subject_id
  having count(*) > 1
)
order by user_id, subject_id, rn;
```

Ожидаемый результат на проблемной базе: для каждой конфликтующей пары несколько строк,
первая по `(created_at, id)` помечена `canonical`, остальные — `duplicate_retry`. Это ровно
правило `ranked` из миграции; удаляются только `rn>1`, а фактические `points` этих строк
вычитаются из `users.reputation_score` по `user_id`.

### Инварианты до и после

До применения допустимы исторические нарушения уникальности, но выборка выше должна
полностью объяснять каждую удаляемую строку. После успешного применения гарантируются:

- для каждого `(user_id, subject_id)` существует не более одной строки с
  `reason='answer_accepted'`;
- сохранена ровно одна каноническая строка на каждый ранее конфликтующий ключ;
- события других причин и другие accept-субъекты сохранены;
- для каждого пользователя `reputation_score_after = reputation_score_before - sum(points)`
  удалённых retry-событий. Миграция не пересчитывает чужую историческую рассинхронизацию
  баланса с ledger и не заменяет `points` константой `15`;
- после установки частичного уникального индекса новый второй reward для той же пары не
  проходит на уровне БД, а кодовый guard в `reputation.ts` предотвращает штатный повтор до
  вставки.

На чистой базе после `pnpm --filter @portal/api run db:migrate` ожидаются ноль нарушений и
созданный индекс:

```sql
select count(*) as violating_keys
from (
  select user_id, subject_id
  from reputation_events
  where reason = 'answer_accepted'
  group by user_id, subject_id
  having count(*) > 1
) duplicates;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'reputation_events_answer_accept_once_idx';
```

Evidence для чистой базы: `violating_keys = 0`, вторая выборка возвращает одну строку с
`CREATE UNIQUE INDEX ... (user_id, subject_id) ... reason = 'answer_accepted'`. Повторный
запуск той же миграции снова блокирует таблицы, не находит `duplicates`, удаляет и создаёт
индекс заново и оставляет те же строки, баланс и единственный уникальный индекс. Поэтому
повторный запуск безопасен; `if not exists` здесь является дополнительной защитой, а не
единственным доказательством уникальности.

Сохранение audit/history проверяется отдельно после миграции: каноническое событие каждого
разного ответа и события других причин не должны исчезнуть:

```sql
select reason, subject_id, count(*) as events
from reputation_events
group by reason, subject_id
order by reason, subject_id;
```

Для fixture
`apps/api/db/migrations/__fixtures__/accept-reputation-duplicates.json` ожидаются две строки
`answer_accepted` (по одной на каждый `subject_id`) и все две строки `post_upvoted`; исчезает
только вторая `answer_accepted` для конфликтующего ключа. Восстановление
`users.reputation_score` на сумму удалённых retry-очков сохраняет итоговый баланс и не меняет
историю других причин.

Регрессионный источник истины —
`apps/api/db/migrations/acceptReputationIdempotency.migration.test.ts`. Он проверяет порядок
блокировок MF-1573, замену одноимённого неуникального индекса MF-1621, fixture и канон,
граничные `NULL`/`CHECK`, чистый `up`, схлопывание с сохранением history, tie-break по `id`,
нулевые нарушения после повторного `up` и неизменность баланса после повторного запуска.
При заданном `DATABASE_URL` тесты выполняются на отдельной БД/схеме; без него SQL-сценарии
пропускаются.

Delivery-гейт поверх реального CLI (MF-1260/MF-1559) —
`pnpm --filter @portal/api run db:check-migrate-replay-gate`
(`apps/api/scripts/check-migrate-replay-gate.sh`), подключён шагом CI рядом с
`db:check-schema-sync`. В отличие от regression-теста выше, он не читает `up`-секцию SQL
напрямую, а прогоняет настоящий `pnpm --filter @portal/api run db:migrate` (dbmate up)
дважды на throwaway БД: сначала до фикса MF-1260 с посеянным историческим
duplicate-fixture `answer_accepted`, затем поверх него саму миграцию — так же, как это
делает `portal.deploy-dev.timer` на реальном dev — и проверяет отсутствие `23505` и
идемпотентный повторный запуск. При регрессе печатает диагностику с ссылкой на этот раздел
и падает с ненулевым кодом до появления коммита в `origin/dev`.

Минимальное воспроизведение исходного `23505` (изолированная временная таблица, прод-данные
не затрагиваются):

```sql
begin;
create temporary table reputation_events (
  id uuid primary key,
  user_id uuid not null,
  points int not null,
  reason text not null,
  subject_type text not null,
  subject_id uuid not null,
  created_at timestamptz not null
);
insert into reputation_events (id, user_id, points, reason, subject_type, subject_id, created_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 15,
   'answer_accepted', 'post', '00000000-0000-0000-0000-000000000100', '2026-07-12T10:00:00Z'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', 15,
   'answer_accepted', 'post', '00000000-0000-0000-0000-000000000100', '2026-07-12T11:00:00Z');
create unique index reputation_events_answer_accept_once_idx
  on reputation_events (user_id, subject_id)
  where reason = 'answer_accepted';
rollback;
```

Ожидаемый вывод `create unique index`: `ERROR: could not create unique index` и `DETAIL` с
одинаковым `(user_id, subject_id)`. В реальной миграции после этого конфликта каноническая
строка (`rn=1`) и все события других причин/субъектов остаются; отдельные строки повторных
ретраев удаляются как неотличимые бизнес-события. Если требуется сохранять каждый технический
ретрай как самостоятельную audit-запись, это изменение контракта и отдельное решение, не
часть MF-1623.

### Откат, остановка и проверка повторного запуска

Миграция запускается до рестарта API через `pnpm --filter @portal/api run db:migrate`. На ошибке
до фиксации транзакции dbmate миграция должна быть остановлена и транзакция откатана: ни
удаления, ни вычитания очков, ни частичного индекса не должно остаться; причину нужно устранить
и повторить проверку на отдельной БД/схеме. После успешной фиксации повторный `up` — штатная
проверка идемпотентности, описанная выше.

`migrate:down` удаляет только `reputation_events_answer_accept_once_idx`. Он не возвращает
схлопнутые строки и не возвращает вычтенные очки, поэтому это не способ восстановления данных
и не должен применяться для отката уже принятого исправления без резервной копии и отдельного
плана восстановления. При необходимости восстановления после фиксации источник истины —
резервная копия/снимок БД; затем повторно выполняются read-only запросы нарушения, history,
баланса и индекса.

Lineage на 2026-07-15: базовая таблица `reputation_events` — `d9107e8`; guard accept —
`07483d4`; миграция — `ed741aa`; тесты миграции — `39aef4a`; dev-деплой до миграции —
`deploy/portal.deploy-dev.sh` на `a3c63fa`. Актуальность этого файла после поставки
проверяется командой `git log -1 --format="%h | %ad | %an" --date=short -- docs/infra/dev.md`.

## Как потушить

Временная мера — тушится одним движением, без потери прод-данных (dev и прод физически разделены
по БД/бакету/env):

```bash
sudo systemctl disable --now portal.deploy-dev.timer portal.api-dev.service \
  portal.mesh-worker-dev.service portal.relay-dev.service
sudo rm /etc/nginx/sites-enabled/dev.3mf.tech.conf \
        /etc/nginx/sites-enabled/api.dev.3mf.tech.conf \
        /etc/nginx/streams-enabled/relay.dev.3mf.tech.conf # L4 passthrough; сверь include-путь локального nginx
sudo nginx -t && sudo systemctl reload nginx
```

БД `portal_dev` и бакет `3mf-dev` можно оставить (ревизия при следующем подъёме среды) или
дропнуть явным решением — это уже необратимый шаг, см. «Красные линии» в CLAUDE.md, делает Ops
по отдельному запросу, не автоматом при обычном «потушить».

## Чеклист приёмки «чужим агентом» (≤10 минут)

1. `webcheck https://dev.3mf.tech/project` → скриншот, не LoginPage, не 404. (~1 мин)
2. `curl -s -H "Cookie: portal_session=$(cat ~/.autofab-session-dev)" https://api.dev.3mf.tech/models`
   → `200` и непустой список. (~30 с)
3. Смоук из раздела «Как проверить» выше целиком — все строки `200`/`autofab-agent`/`401` там где
   ожидается. (~2 мин)
4. `psql` проверка сида (раздел «Как проверить») — 20 ready-моделей. Если пусто — прогнать
   `pnpm --filter @portal/api seed:dev` (раздел «Как засидить»), повторить проверку. (~3 мин)
5. Если что-то не сошлось с этой докой — сверить `~/portal.api-dev.env` (флаги `AUTH_DEV_BYPASS`,
   `CLOSED_DEV`) с разделом «Как зайти»: доку могла обогнать очередная директива оператора, как
   уже было с MF-1032 — env на VDS всегда источник истины, не текст эпика.
