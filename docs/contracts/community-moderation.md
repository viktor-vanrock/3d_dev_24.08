# Контракт данных модерации сообщества (MF-1417)

Статус: согласованный handoff для `apps/api/src/db`, без реализации API и web.

Основания: `docs/issues/007.database.design.md`, `docs/epics/community.foundation.md`
(MF-414), направление MF-415, карточка MF-416 и UX-контракт
`docs/design/community.moderation.md` (MF-1419). Контракт рассчитан на текущую
схему `communities → threads → posts`; `target_type` оставляет тот же расширяемый
полиморфный шов, что уже принят для `votes` и `taggings`.

## 0. Граница физической поставки

Каноническая модель ниже включает три доменные таблицы — `flags`,
`moderation_actions` и `audit_events`, — но они поставляются не одной ранней
миграцией. Опубликованная `apps/api/db/migrations/20260713010000_moderation_actions.sql`
создаёт только историческую форму `moderation_actions` и не является полной
реализацией этого контракта.

Единственным владельцем следующей аддитивной dbmate-миграции является
[MF-1435](https://tasks.3mf.tech). Она выполняется после
`20260713010000_moderation_actions.sql` и поставляет `flags`, канонические поля
статуса/reversal для `moderation_actions`, `audit_events` и durable idempotency
по согласованной схеме. В рамках MF-1437.3 отдельная миграция для
`audit_events` не создаётся: это предотвращает дублирование таблицы и оставляет
один источник истины для её ограничений, индексов и rollback.

До поставки MF-1435 acceptance этого контракта считается заблокированным, а
ранняя миграция не может объявляться готовой поставкой `flags` или
`audit_events`. API и интеграционные сценарии не должны подключать эту
неполную таблицу как источник истины.

## 1. Область и инварианты

Каноническая модель состоит из трёх таблиц: `flags` (жалоба пользователя),
`moderation_actions` (решение модератора или автоматическое действие) и
`audit_events` (неизменяемый журнал). Физическая граница их поставки указана в
§0; `target_type` принимает только `thread` или
`post`, а `target_id` хранит UUID соответствующего объекта. Для полиморфной пары
FK на `target_id` невозможен: API обязан проверить существование цели и её тип в
той же транзакции. Нельзя принимать жалобу на несуществующую цель.

Все первичные ключи — `uuid primary key default gen_random_uuid()`; внешние ключи
на пользователей и связанные строки — UUID. Внешние ссылки на пользователя
удаляются `on delete restrict` (история не должна исчезнуть вместе с аккаунтом).
Целевой контент не удаляется каскадно: при удалении/soft-delete контента его
флаги и журнал сохраняются.

Причины — стабильные ASCII-коды, а не пользовательский текст. Минимальный enum:
`illegal_or_dangerous`, `copyright`, `spam_or_fraud`, `harassment`, `other`.
`other` требует непустого `details`; для остальных причин `details` опционально.
Публичная локализация причины выполняется в API, raw-текст пояснения не
возвращается читателю без разрешения роли.

## 2. Таблицы и ограничения

Ниже — обязательная форма миграции. Имена enum можно реализовать как `text` с
`check`, как в community foundation; отдельные PostgreSQL-типы не требуются.

### `flags`

| Поле | Требование |
|---|---|
| `id` | PK UUID v4 |
| `target_type`, `target_id` | `target_type in ('thread','post')`, оба `not null`; FK технически невозможен, проверка в API/транзакции |
| `reporter_id` | `not null references users(id) on delete restrict` |
| `reason_code` | `not null`, enum из §1 |
| `details` | nullable `text`; `btrim(details) <> ''` при передаче; обязателен для `other` |
| `status` | `open` по умолчанию; enum `open`, `in_review`, `actioned`, `rejected`, `withdrawn` |
| `client_request_id` | `uuid not null`; уникален в паре с `reporter_id`, связывает безопасный повтор HTTP-запроса с исходным флагом |
| `created_at`, `updated_at` | `timestamptz not null default now()` |
| `withdrawn_at`, `withdrawn_by` | nullable; заполняются только при `status='withdrawn'`, `withdrawn_by` — FK `users` |

Один пользователь может создать только одну незакрытую жалобу на цель:

```sql
create unique index flags_reporter_request_key
  on flags (reporter_id, client_request_id);
create unique index flags_reporter_target_active_key
  on flags (reporter_id, target_type, target_id)
  where status in ('open', 'in_review');
```

Повторная отправка должна получать доменный конфликт `FLAG_ALREADY_EXISTS`, а
не создавать вторую строку. Исторический `rejected`/`withdrawn` флаг не запрещает
новую жалобу: это осознанное различие между текущей и исторической попыткой.
Тот же `client_request_id` возвращает исходный `flag`, а его повтор с другим
payload отклоняется как `IDEMPOTENCY_KEY_REUSED`; это отличается от содержательного
дедупа активной жалобы.

### `moderation_actions`

| Поле | Требование |
|---|---|
| `id` | PK UUID v4 |
| `flag_id` | nullable FK `flags(id) on delete restrict`; nullable только для системного действия, не связанного с конкретной жалобой |
| `target_type`, `target_id` | `not null`, та же полиморфная пара; при `flag_id` обязана совпадать с целью флага |
| `actor_id` | `not null references users(id) on delete restrict`; системный actor — отдельный технический пользователь/идентификатор на слое API, не `NULL` |
| `action_type` | enum `hide`, `restore`, `lock_thread`, `unlock_thread`, `reject_flag` |
| `status` | `applied` или `reversed`, по умолчанию `applied` |
| `reason_code` | обязательный код причины из §1; для `reject_flag` может быть `other`, но всё равно требуется пояснение |
| `details` | обязательное непустое пояснение для ручного решения; не публикуется без policy-gate |
| `created_at` | `timestamptz not null default now()` |
| `reversed_at`, `reversed_by`, `reversal_reason` | nullable; комплект обязателен при `status='reversed'` |

Действие не редактируется и не удаляется. «Отмена» — это переход `applied →
reversed` с сохранением автора, времени и причины отмены; повторная отмена
возвращает конфликт `ACTION_ALREADY_REVERSED`. Новое решение создаёт новую строку
и не переписывает старую. Для одного target допускается только одно активное
`hide` и одно активное `lock_thread`; это частичные уникальные индексы, чтобы
повторный запрос был идемпотентным на уровне БД.

`restore` допустим только для активного `hide`, `unlock_thread` — только для
активного `lock_thread`; связь и проверка выполняются в транзакции, не в UI.

### `audit_events`

| Поле | Требование |
|---|---|
| `id` | PK UUID v4 |
| `actor_id` | `not null references users(id) on delete restrict` |
| `entity_type`, `entity_id` | enum `flag`, `moderation_action`, `thread`, `post`; UUID |
| `event_type` | enum `created`, `status_changed`, `action_applied`, `action_reversed`, `appeal_created` |
| `from_status`, `to_status` | nullable text; для `status_changed` оба обязательны и проверяются API |
| `metadata` | `jsonb not null default '{}'`, только безопасные структурированные данные; секреты и полный текст жалобы не дублировать |
| `created_at` | `timestamptz not null default now()` |

Журнал append-only: UPDATE/DELETE для приложения запрещены правами роли БД.
Снимок перехода хранится в событии, поэтому audit не зависит от текущего
состояния строки. Жалобщик и его детали не попадают в публичную выдачу по
умолчанию.

Форму строки нужно защищать в БД, а не оставлять только на уровне валидатора
HTTP. Минимальный набор `check` для миграции (имена ограничений могут отличаться):

```sql
check (details is null or btrim(details) <> ''),
check (reason_code <> 'other' or details is not null),
check (
  (status = 'withdrawn' and withdrawn_at is not null and withdrawn_by is not null)
  or
  (status <> 'withdrawn' and withdrawn_at is null and withdrawn_by is null)
)
```

Для `moderation_actions` аналогично обязательны `btrim(details) <> ''` и
симметричная проверка reversal-комплекта:

```sql
check (
  (status = 'reversed'
    and reversed_at is not null and reversed_by is not null
    and btrim(reversal_reason) <> '')
  or
  (status = 'applied'
    and reversed_at is null and reversed_by is null and reversal_reason is null)
),
check (action_type <> 'unlock_thread' or target_type = 'thread')
```

Для `audit_events` `from_status` и `to_status` обязательны ровно для
`status_changed`, а для остальных типов событий должны оставаться `NULL`.
Проверка допустимости самого перехода (`open → in_review`, `in_review → ...`,
`applied → reversed`) является транзакционной обязанностью API/DB-функции: один
`CHECK` не видит предыдущее состояние строки. Прямые `UPDATE`/`DELETE` роли API
запрещены, поэтому обход этой границы не должен быть возможен через SQL.

## 3. Переходы состояний

```text
flags: open → in_review → actioned
                    ├────→ rejected
                    └────→ withdrawn (только reporter до решения)

moderation_actions: applied → reversed
```

Нельзя перескочить из `open` в `actioned` без созданного `moderation_action` и
audit-события. Нельзя менять `withdrawn`, `rejected` или `actioned`; исправление
ошибки оформляется новой записью/действием. `in_review` означает захват очереди,
но не меняет видимость цели. `hide` меняет видимость контента, `restore` отменяет
только конкретное активное скрытие. Скрытие — soft-delete/visibility state:
исходная строка `posts`/`threads` не удаляется, `audit_events` не очищаются.

Если в будущем добавляется `appeal`, это отдельная сущность/миграция; её решение
не должно переписывать исходное `moderation_action`, а только создавать новое
действие и audit-событие.

## 4. Транзакционные границы API

Каждый mutation endpoint выполняет одну транзакцию с `select ... for update` по
цели и связанным активным флагам. Порядок блокировок: target → flags → action.
Это исключает гонку двух пороговых жалоб и двойное скрытие.

1. **Создание флага:** проверить session/роль и target; вставить `flags`; записать
   `audit_events(created)`; commit. Автоскрытие (если порог уже достигнут) в той
   же транзакции создаёт `moderation_actions(hide)`, меняет статус/видимость цели,
   переводит флаг(и) в `actioned` и пишет отдельные audit-события.
2. **Взять в работу:** lock флага, проверить `open`, записать `in_review` и
   audit; commit. Чтение очереди ничего не меняет.
3. **Решение:** lock target и flag, проверить допустимость `action_type`, вставить
   action, применить изменение `posts.status`/`threads.status`, перевести флаг,
   записать audit; commit. Любая ошибка откатывает все записи.
4. **Reversal:** lock исходного action и target, проверить `applied` и право
   отмены, восстановить ровно состояние, которым управляло действие, пометить
   action `reversed`, записать audit; commit. Нельзя восстанавливать уже отдельно
   скрытый target.
5. **Withdraw:** lock флага, разрешить только его reporter до `in_review`, записать
   `withdrawn_at`/`withdrawn_by` и audit; commit. Никаких физических DELETE.

Очередь читает только keyset по `(created_at desc, id desc)` с индексом; OFFSET и
глобальный `COUNT(*)` в публичном ответе не используются.

## 5. Индексы и конфликтные случаи

Обязательны:

```sql
create index flags_queue_idx on flags (status, created_at desc, id desc);
create index flags_target_idx on flags (target_type, target_id, created_at desc);
create index moderation_actions_target_idx
  on moderation_actions (target_type, target_id, created_at desc);
create index audit_entity_idx
  on audit_events (entity_type, entity_id, created_at desc, id desc);
```

Также нужны частичные уникальности активных действий:

```sql
create unique index moderation_active_hide_key
  on moderation_actions (target_type, target_id)
  where action_type = 'hide' and status = 'applied';
create unique index moderation_active_lock_key
  on moderation_actions (target_type, target_id)
  where action_type = 'lock_thread' and status = 'applied';
```

Миграционный checklist и обязательные интеграционные проверки:

- [ ] PK/FK, `on delete restrict`, enum/check и `other → details` реально создаются
  и проверяются в PostgreSQL; `target_id` не объявлен ложным FK.
- [ ] Дубликат активного флага от одного reporter даёт unique-конфликт; два разных
  reporter на одну цель разрешены.
- [ ] Гонка двух `hide` оставляет одну активную action; повторный запрос не меняет
  счётчик/видимость дважды.
- [ ] `restore` без активного `hide`, `unlock_thread` для post и reversal после
  reversal отклоняются без частичного commit.
- [ ] `withdraw` после `in_review`/решения, чужой withdraw и ручное DELETE
  отклоняются; исходный audit остаётся.
- [ ] FK не позволяет удалить пользователя, являющегося reporter/actor; удаление
  post/thread не каскадирует историю модерации.
- [ ] `audit_events` содержит последовательность исходного решения и reversal,
  не принимает UPDATE/DELETE от роли API.
- [ ] `up → rollback → up` проходит на baseline; `apps/api/db/schema.sql`
  передамплен после миграции и проверен скриптом синхронизации.

## 6. Handoff в `apps/api/src/db`

В репозитории уже есть ранняя миграция
`apps/api/db/migrations/20260713010000_moderation_actions.sql` с другой моделью
(`scope`, `actor_role`, `action`, `reason`). Она не является реализацией этого
контракта: опубликованную миграцию нельзя переписывать, а новую схему нельзя
«тихо» смешивать с её колонками. MF-1435 отдельной аддитивной dbmate-миграцией
должна согласовать/расширить baseline, добавить `flags` и `audit_events`,
привести `moderation_actions` к §2, поставить durable idempotency и передампить
`apps/api/db/schema.sql`; до этого API не должен считать старую таблицу
источником истины. Эта миграция зависит от ранней формы и выполняется после
неё. Параллельная миграция `audit_events` в рамках MF-1437.3 не создаётся.

После поставки MF-1435 API-контракт MF-1417 использует эти переходы. Слой API
обязан держать target lock, не раскрывать reporter без policy,
возвращать `FLAG_ALREADY_EXISTS`/`ACTION_ALREADY_REVERSED` и не считать локальное
состояние web источником истины. Апелляции, TL0-лимиты и UI остаются за
соответствующими карточками MF-1418/MF-1419/MF-1423.

## 7. Версия API, privacy и наблюдаемость

Контракт HTTP имеет версию `v1`; новые поля добавляются только опциональными. Web
не читает таблицы: создаёт флаг через API с сессионной авторизацией и обязательным
`Idempotency-Key`, равным `client_request_id`. Неавторизованный получает
`401 UNAUTHORIZED`, пользователь без роли — `403 FORBIDDEN`, скрытая/чужая цель —
`404 TARGET_NOT_FOUND`, устаревшее решение модератора — `409 STALE_TARGET_STATE`.
Проверка `community_members.role` ограничивает moderator своим community; глобальные
действия остаются за `users.is_staff`.

```json
{
  "schema_version": "v1",
  "target": { "type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691" },
  "reason_code": "illegal_or_dangerous",
  "details": "Нет предупреждения о высокой температуре.",
  "client_request_id": "5705e0ed-03be-4a6f-a6f1-01f69269b130"
}
```

```json
{
  "schema_version": "v1",
  "id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677",
  "status": "open",
  "created_at": "2026-07-13T09:00:00Z"
}
```

В логи и метрики попадают только `request_id`, UUID и enum: например,
`moderation_flag_created_total{target_type,reason_code}` и
`moderation_idempotency_replay_total`. Текст `details`, evidence, cookie, IP и
signed URL не логируются; аудит хранит лишь redacted-метаданные. При анонимизации
аккаунта display-проекция редактируется, но UUID и audit сохраняются по legal
hold/сроку расследования; срок до production фиксирует privacy-владелец.

Контракт не меняет account↔printer identity и `config_fingerprint`. Будущий P2P
объект может стать новым аддитивным `target_type` только отдельной миграцией с
проверкой владельца и fingerprint; P2P data-plane в v1 не реализуется.

## 8. Privacy, evidence и retention (MF-1430)

Этот раздел является обязательной политикой для реализации MF-1417. Он не
разрешает собирать дополнительные данные «на будущее»: любое новое поле с ПДн
требует отдельного решения владельца privacy и ссылки на него в миграции/API.

### 8.1. Минимизация и доступ по сущностям

| Сущность | Что храним | Что не храним/не выдаём | Доступ |
|---|---|---|---|
| `flags` | UUID цели, UUID reporter, код причины, минимальное пояснение, статусы и времена | cookie, bearer/API-ключи, IP, user-agent, signed URL; `details` не показывается публично | reporter — только свои флаги; moderator — флаги своей community; staff — глобальный контур |
| `moderation_actions` | UUID actor, цель, тип действия, код причины, обязательное служебное пояснение, reversal-данные | секреты и полные копии пользовательского контента; служебное пояснение не публикуется без policy-gate | только moderator/staff с правом на target; reporter видит лишь публичный итог |
| `audit_events` | actor/entity UUID, тип события, переход статуса, redacted-метаданные | текст жалобы, evidence-файлы, IP, cookie, токены и произвольный JSON от клиента | только staff/privacy/audit по роли и цели расследования; публичного endpoint нет |
| target `posts`/`threads` | исходный контент и штатный visibility/soft-delete статус | физическое удаление как способ скрыть историю модерации | читатель — только опубликованное; moderator — цель в рамках community; staff — по расследованию |
| evidence/вложения | только явно загруженный материал, необходимый для конкретного решения, с UUID и linkage на флаг/action | секреты, credentials, auth-заголовки, дампы cookies и необработанные логи | deny-by-default; доступ по короткоживущей подписанной ссылке только участникам расследования |

UUID в этих таблицах — идентификатор связи, а не публичное раскрытие личности.
Ответы API должны использовать display-проекцию: после удаления/анонимизации
аккаунта имя и аватар заменяются на нейтральное значение, а UUID сохраняются
только в закрытом audit-контуре.

### 8.2. Retention, удаление и legal hold

До утверждения privacy-владельцем production-сроки считаются **не заданными**:
реализация не должна придумывать TTL. Владелец privacy обязан до production
зафиксировать срок для каждого класса данных в конфигурации retention и покрыть
его тестом. Минимальные правила процесса:

1. `flags` и `moderation_actions` хранятся до окончания срока расследования и
   срока на appeal; после этого удаляются или анонимизируются только в рамках
   утверждённой политики.
2. `audit_events` append-only и не удаляются вместе с target. По истечении
   retention допускается только контролируемая анонимизация actor/display-полей,
   если это не нарушает legal hold и требования доказуемости.
3. `posts`/`threads` удаляются логически: исходная строка и связь с audit не
   исчезают каскадом. Физическое удаление возможно только отдельным процессом,
   который сначала проверяет отсутствие hold и сохраняет требуемый redacted audit.
4. Evidence имеет отдельный, не более длинный без причины срок хранения и
   удаляется из S3 вместе с метаданными после завершения дела. Подписанные ссылки
   истекают раньше срока хранения и не являются постоянным правом доступа.
5. Legal hold блокирует удаление и анонимизацию связанных `flags`, actions,
   audit и evidence, фиксирует кто/когда/по какой причине его установил и
   снимается отдельным audit-событием. Hold не расширяет доступ к данным.

Запрос на удаление/анонимизацию маршрутизируется через privacy-владельца:
сначала вычисляется граф связанных сущностей и активных hold, затем выполняется
идемпотентная операция с audit-следом. Нельзя удалять reporter/actor FK так,
чтобы переписать историю или заменить её фиктивными секретными данными.

### 8.3. Логирование и handoff

В application-логи и метрики разрешены только `request_id`, UUID, enum-коды,
результат операции и технические latency/error-классы. Запрещены `details`,
evidence, raw request/response, cookie, Authorization, IP, signed URL и полный
текст target. Redaction выполняется до retention и до отправки в любой внешний
сборщик; тестовые fixtures используют вымышленные UUID и текст.

**Handoff Backend:** реализовать policy-gate ролей и community scope, deny-by-
default для evidence, redaction до логгера, таблицу/механизм legal hold,
идемпотентное удаление/анонимизацию и retention-конфигурацию только после
решения privacy-владельца. Отдельно подтвердить, что `on delete restrict`,
append-only audit и отсутствие каскадного удаления target сохранены.

**Handoff QA:** проверить доступ reporter/moderator/staff и отказ по чужой
community; отсутствие секретов в логах, audit и fixtures; истечение signed URL;
повтор удаления; блокировку удаления active hold; снятие hold с audit-событием;
анонимизацию display-проекции при сохранении UUID/audit; rollback без частичного
удаления. Evidence приёмки не должен содержать реальные ПДн или credentials.
