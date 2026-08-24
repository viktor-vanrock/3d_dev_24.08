# Acceptance-контракт модерации сообщества v1 (MF-1432, решение MF-1437.1)

Статус: QA-контракт для Backend и интеграционных проверок; UI не является
источником истины. Все сценарии должны выполняться через API и подтверждаться
состоянием `flags`, `moderation_actions`, `audit_events` и целевого
`posts`/`threads`.

## Основания и границы

- [MF-416](https://tasks.3mf.tech) — направление модерации сообщества;
- [MF-414](https://tasks.3mf.tech) — community foundation, роли и trust-level;
- [MF-415](https://tasks.3mf.tech) — API-фаза сообщества;
- [`community-moderation.md`](community-moderation.md) — каноническая модель
  `flag → moderation_action → audit_event`, транзакции и retention;
- [`community-moderation-api.md`](community-moderation-api.md) — HTTP boundary,
  authorization, идемпотентность и коды ошибок;
- [`community-moderation-review.md`](community-moderation-review.md) — проверка
  терминов, scope и известных рисков.
- [`community-moderation-actions.md`](community-moderation-actions.md) —
  согласованная граница `applied → reversed`, конкурентный reversal и порядок
  поставки;
- [MF-1435](https://tasks.3mf.tech) — обязательная Data-миграция канонических
  `flags`, `moderation_actions`, `audit_events` и durable idempotency.

Вне scope: визуальные состояния, appeal как отдельная сущность и конкретные
production TTL до решения privacy-владельца. API/миграция принимаются только
после поставки MF-1435; ранняя миграция `20260713010000_moderation_actions.sql`
сама по себе этому контракту не соответствует.

## Test fixture и трассировка

Все UUID и тексты ниже вымышлены. `community_id` берётся из `target`; actor и
reporter извлекаются из проверенной сессии и не принимаются из JSON.

| Сущность/поле | Проверяется | Риск | Доказательство |
|---|---|---|---|
| `flags.client_request_id` | повтор того же запроса и reuse с другим payload | двойная жалоба или неоднозначный retry | один `flag`, `200` при replay, `409 IDEMPOTENCY_KEY_REUSED` |
| `flags(reporter_id,target)` | один активный flag на reporter и target | дублирование очереди | `409 FLAG_ALREADY_EXISTS`, два reporter допускаются |
| `flags.status` | только разрешённые переходы | обход решения/отзыва | `409 INVALID_TRANSITION`, audit перехода |
| `moderation_actions` | атомарность решения, один active hide/lock | двойное действие и гонка | одна active action, visibility изменена один раз |
| `moderation_actions.status` | единственный reversal исходной action без изменения доказательных полей | потеря доказательства/двойная отмена | `applied → reversed`, одна compensating action и `action_reversed` |
| target `posts/threads` | stale state и область действия | решение поверх нового состояния | `409 STALE_TARGET_STATE`, без частичного commit |
| `audit_events` | полнота append-only цепочки | невозможность расследования | ordered events с actor/entity/status snapshot |
| роли/scope | reporter, moderator community, staff | IDOR и cross-community доступ | `401/403/404`, отсутствие утечки существования |
| retention/legal hold | удаление и анонимизация | преждевременная потеря данных | hold блокирует операцию, повтор идемпотентен |

## Общие правила приёмки

1. Каждый mutation выполняется одной транзакцией; ошибка на любом шаге не
   оставляет action, смену visibility или неполный audit.
2. Повтор с тем же ключом и тем же телом возвращает исходный результат и не
   создаёт новые строки. Повтор с тем же ключом и другим телом — `409`.
3. `reporter_id`/`actor_id` и scope вычисляются сервером из сессии; значения
   клиента игнорируются или отклоняются.
4. `details`, evidence, cookie, Authorization, IP, signed URL и полный target
   не попадают в логи, метрики и redacted audit metadata.
5. Любая проверка доступа не должна раскрывать наличие чужой или скрытой цели:
   в зависимости от endpoint возвращается предусмотренный `403` либо `404`.
6. После каждого сценария Backend проверяет строки БД и audit; QA проверяет
   HTTP-код, публичное тело, отсутствие секретов и число созданных событий.
7. До запуска сценариев MF-1435 обязан подтвердить SQL-инварианты: `status`
   допускает только `applied|reversed`; reversal-поля заполнены тогда и только
   тогда, когда source имеет `reversed`; `reverses_action_id` уникален; запись
   идемпотентности хранит fingerprint и исходный результат. Эти ограничения
   проверяются после `up → rollback → up` и совпадают со `schema.sql`.

## Given/When/Then сценарии

### A. Повторы и идемпотентность

#### A1. Повтор создания flag

**Given** авторизованный `reporter-1` отправил валидный `POST /v1/community/flags`
с `client_request_id=11111111-1111-4111-8111-111111111111` на доступный post.

**When** он повторяет тот же запрос с тем же `Idempotency-Key` и телом.

**Then** первый ответ — `201`, повтор — `200`; оба ответа содержат один `id`;
в `flags` ровно одна строка и ровно одно событие `created`.

#### A2. Reuse ключа с другим payload

**Given** ключ из A1 уже связан с исходным post.

**When** тот же reporter повторяет запрос с тем же ключом, но меняет
`reason_code` или `target`.

**Then** ответ `409 IDEMPOTENCY_KEY_REUSED`; исходный flag и его audit не
изменены; новая строка не создана.

#### A3. Дубликат активного flag

**Given** `reporter-1` уже имеет `open` или `in_review` flag на post.

**When** он отправляет новый ключ на тот же target.

**Then** ответ `409 FLAG_ALREADY_EXISTS`; исторические `rejected`/`withdrawn`
flags не считаются активным дубликатом и не блокируют новую жалобу.

#### A4. Повтор решения и reversal

**Given** action `hide` уже применён к post.

**When** moderator повторяет decision с тем же ключом, а затем повторяет
reversal с тем же ключом.

**Then** повтор каждого запроса возвращает исходный результат; active hide,
visibility и число audit-событий не удваиваются. Повтор reversal с тем же
ключом возвращает сохранённый `200`; новый ключ после завершённого reversal
возвращает `409 ACTION_ALREADY_REVERSED`. Тот же ключ с иным телом возвращает
`409 IDEMPOTENCY_KEY_REUSED`.

### B. Stale state и транзакционные границы

#### B1. Устаревшее решение

**Given** moderator открыл flag в `open`, но другой actor уже перевёл его в
`in_review` или изменил target.

**When** первый moderator отправляет decision с устаревшим version/state.

**Then** ответ `409 STALE_TARGET_STATE` или `409 INVALID_TRANSITION` согласно
контракту; не создаются partial action, visibility update или status audit.

#### B2. Гонка двух hide

**Given** два допустимых moderator-запроса одновременно решают один target.

**When** оба доходят до транзакционной границы target → flags → action.

**Then** только одна транзакция создаёт active `hide`; вторая получает
`409 ACTIVE_ACTION_EXISTS` либо идемпотентный результат для того же ключа.
Target скрыт один раз, обе транзакции не оставляют orphan audit.

#### B3. Недопустимый reversal после нового hide

**Given** action A скрыл target, затем action A был заменён/дополнен новым
самостоятельным hide B.

**When** вызывается reversal для A.

**Then** сервер не восстанавливает target поверх B и отклоняет операцию как
stale/conflicting state; A не помечается reversed частично.

### C. Unauthorized action и scope

#### C1. Отсутствует сессия

**Given** запрос не содержит действующей сессии.

**When** вызывается любой endpoint mutation или private read.

**Then** ответ `401 UNAUTHORIZED`; actor/reporter не подставляется из body;
строки и audit не создаются.

#### C2. Обычный пользователь пытается модерировать

**Given** `user-1` — обычный member без moderator/staff роли.

**When** он вызывает claim, decision, audit или reversal для чужого action.

**Then** ответ `403 FORBIDDEN`; target, action и audit остаются без изменений.

#### C3. Moderator чужой community

**Given** `moderator-a` имеет роль moderator только в `community-a`, а target
находится в `community-b`.

**When** он меняет `community_id` в query/body или вызывает action напрямую.

**Then** ответ `403 SCOPE_FORBIDDEN` (или предусмотренный `404` для private
read); реальный scope не раскрывается, action не создан.

#### C4. Client-controlled actor/reporter

**Given** валидная сессия `user-1` содержит в JSON чужой `reporter_id` или
`actor_id`.

**When** выполняется создание flag/decision.

**Then** запись содержит UUID из сессии; подмена не меняет ownership и не даёт
прав другого actor.

### D. Reversal и неизменяемость доказательств

#### D1. Успешный reversal

**Given** applied `hide` создан с action id, actor и причиной.

**When** разрешённый staff или создатель action вызывает reversal с непустой
причиной.

**Then** исходная action сохраняет все исходные поля, получает
`status=reversed`, `reversed_at`, `reversed_by`, `reversal_reason`; target
восстановлен только если нет более нового конфликтующего hide; создана ровно
одна applied-компенсирующая action с `reverses_action_id` source; добавлен
`action_reversed` с ссылкой на source и компенсацию.

#### D1a. Гонка двух reversal

**Given** source action находится в `applied`, и два разрешённых запроса на её
reversal приходят одновременно с разными `Idempotency-Key`.

**When** оба пытаются заблокировать один target и source action.

**Then** одна транзакция переводит source в `reversed`, создаёт одну
компенсирующую action и один `action_reversed`; вторая после блокировки получает
`409 ACTION_ALREADY_REVERSED`. Ни visibility, ни audit, ни `reverses_action_id`
не меняются вторично. Повтор выигравшего запроса с тем же ключом возвращает его
сохранённый `200` без новой строки.

#### D2. Запрещено редактировать историю

**Given** есть applied/reversed action и audit chain.

**When** клиент пытается выполнить UPDATE/DELETE action или audit через API.

**Then** операция запрещена; исходные строки и порядок событий не изменились.

### E. Retention, privacy и legal hold

#### E1. Hold блокирует retention operation

**Given** флаг, action, audit и evidence связаны с активным legal hold.

**When** retention worker повторно запускает удаление/анонимизацию.

**Then** связанные данные не удаляются и не анонимизируются; результат явно
`skipped_legal_hold`; повтор не создаёт дубликат hold/audit и не расширяет
доступ. Установка/снятие hold имеет отдельное audit-событие.

#### E2. Идемпотентная анонимизация после hold

**Given** hold снят разрешённым privacy actor и срок retention истёк.

**When** одна и та же операция анонимизации запускается один или несколько раз.

**Then** display-поля редактируются ровно один раз, UUID и требуемая audit-связь
сохраняются; повтор не ломает FK и не создаёт новый исходный event.

#### E3. Evidence и секреты

**Given** fixture содержит evidence UUID и короткоживущую signed URL.

**When** проверяются API-ответ, логирование, audit и expiry URL.

**Then** URL доступна только разрешённому участнику до expiry; после expiry
доступ запрещён; секреты, cookies, токены, IP и полный текст target отсутствуют
в логах, метриках, audit и fixtures.

### F. Полнота audit

#### F1. Полная цепочка flag → action → reversal

**Given** выполнены создание flag, claim, decision `hide` и reversal.

**When** staff читает audit с фильтрами по entity и cursor.

**Then** возвращаются события `created`, `status_changed` для claim/decision,
`action_applied`, `action_reversed` в порядке `(created_at desc, id desc)` с
непротиворечивыми `from_status/to_status`, actor/entity UUID и redacted metadata.

#### F2. Ошибка не оставляет ложный audit

**Given** decision отклонён из-за stale target, недопустимой роли или DB conflict.

**When** транзакция завершена ошибкой.

**Then** не появляется `action_applied`/status event, которого не произошло;
исходные события остаются append-only и читаются повторно.

## JSON fixtures

### 1. Базовый контекст и создание flag

```json
{
  "fixture": "mf1432-basic-flag",
  "session": {"user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "member"},
  "community": {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
  "target": {"type": "post", "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "community_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "visibility": "published", "version": 7},
  "request": {
    "method": "POST",
    "path": "/v1/community/flags",
    "headers": {"Idempotency-Key": "11111111-1111-4111-8111-111111111111"},
    "body": {
      "schema_version": "v1",
      "target": {"type": "post", "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
      "reason_code": "spam_or_fraud",
      "details": "Повторяющаяся рекламная публикация.",
      "client_request_id": "11111111-1111-4111-8111-111111111111"
    }
  },
  "expect": {"status": 201, "flag_status": "open", "audit_events": ["created"], "flags_count": 1}
}
```

### 2. Ошибки повторов и доступа

```json
{
  "fixture": "mf1432-negative-matrix",
  "cases": [
    {"name": "same-key-same-body", "status": 200, "code": null, "assert": "same_flag_id_and_no_new_audit"},
    {"name": "same-key-different-body", "status": 409, "code": "IDEMPOTENCY_KEY_REUSED"},
    {"name": "active-duplicate", "status": 409, "code": "FLAG_ALREADY_EXISTS"},
    {"name": "anonymous", "status": 401, "code": "UNAUTHORIZED"},
    {"name": "member-decision", "status": 403, "code": "FORBIDDEN"},
    {"name": "foreign-community-moderator", "status": 403, "code": "SCOPE_FORBIDDEN"},
    {"name": "stale-decision", "status": 409, "code": "STALE_TARGET_STATE"},
    {"name": "second-reversal", "status": 409, "code": "ACTION_ALREADY_REVERSED"}
  ],
  "forbidden_log_fields": ["details", "evidence", "cookie", "authorization", "ip", "signed_url", "target_text"]
}
```

### 3. Ожидаемая audit-цепочка

```json
{
  "fixture": "mf1432-audit-chain",
  "entity": {"type": "flag", "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
  "events": [
    {"event_type": "created", "entity_type": "flag", "from_status": null, "to_status": "open"},
    {"event_type": "status_changed", "entity_type": "flag", "from_status": "open", "to_status": "in_review"},
    {"event_type": "action_applied", "entity_type": "moderation_action", "from_status": null, "to_status": "applied"},
    {"event_type": "status_changed", "entity_type": "flag", "from_status": "in_review", "to_status": "actioned"},
    {"event_type": "action_reversed", "entity_type": "moderation_action", "from_status": "applied", "to_status": "reversed"}
  ],
  "assert": {"append_only": true, "ordered": true, "metadata_redacted": true, "no_target_text": true}
}
```

## Handoff и критерий готовности

Backend обязан сопоставить каждый сценарий с интеграционным тестом, миграцией и
ответом API; при расхождении обновляется канонический контракт, а не fixture.
QA принимает MF-1417 только когда сценарии A–F покрыты, rollback не оставляет
частичных строк, а commit с этим документом опубликован в `origin/dev` с
маркером `MF-1417`.
