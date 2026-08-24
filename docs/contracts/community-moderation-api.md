# HTTP-контракт модерации сообщества v1 (MF-1429)

Статус: API boundary для реализации Fullstack/Back; UI в этот документ не входит.

Основания: MF-416, MF-414, MF-415, MF-1417 и
`docs/design/community.moderation.md` (MF-1419). Базовый путь —
`/v1/community`. Ответы JSON, идентификаторы — UUID, время — ISO-8601 UTC.
Все успешные и ошибочные ответы содержат `x-request-id` и
`X-Community-Policy-Version: community-antiabuse.v1`.

## 1. Матрица ручек

| Метод и путь | Назначение | Кто может вызвать | Идемпотентность |
|---|---|---|---|
| `POST /flags` | Создать жалобу на `thread` или `post` | авторизованный пользователь | `Idempotency-Key` обязателен; равен `client_request_id` |
| `GET /flags/:id` | Прочитать собственный флаг или флаг в своей очереди | reporter; moderator своей community; staff | нет |
| `POST /flags/:id/withdraw` | Отозвать свою жалобу до захвата очереди | reporter, пока `open` | `Idempotency-Key` обязателен |
| `GET /moderation/queue` | Очередь жалоб | moderator своей community; staff — все доступные | нет, keyset |
| `POST /flags/:id/claim` | Взять жалобу в работу (`open → in_review`) | moderator/staff с доступом к цели | `Idempotency-Key` обязателен |
| `POST /flags/:id/decision` | Применить решение или отклонить жалобу | moderator/staff с доступом к цели | `Idempotency-Key` обязателен |
| `GET /moderation/actions/:id` | Прочитать действие и его reversal | moderator/staff с доступом к цели | нет |
| `POST /moderation/actions/:id/reversal` | Отменить применённое действие | staff или moderator, создавший действие, по policy | `Idempotency-Key` обязателен |
| `GET /moderation/audit` | Читать append-only аудит | staff; moderator — только своей community и без privacy-полей | нет, keyset |

`POST /flags` не позволяет жаловаться на скрытую/недоступную цель и не раскрывает,
существует ли чужой флаг. Один reporter имеет один активный флаг на цель.
Действия не редактируются и не удаляются: отмена создаёт зафиксированный reversal.

## 2. Авторизация и границы доступа

API принимает только сессию/токен аккаунта; отсутствие аутентификации — `401`.
`reporter_id` и `actor_id` берутся из проверенной identity, не из JSON. Клиент не
может выбрать `actor_id`, системного актёра или community.

Обычный пользователь видит только собственный флаг (и только безопасные поля),
может создать флаг и отозвать его до `in_review`. Moderator получает очередь и
детали только для community, где его `community_members.role=moderator`;
глобальные действия доступны staff (`users.is_staff`). Moderator не может
назначить себе другую community через query/body и не может читать IP, cookie,
evidence, raw `details` другого пользователя или внутренние privacy-метаданные.
Staff соблюдает тот же запрет на выдачу секретов; audit отдаёт только redacted
metadata. Цель проверяется как `thread|post` в транзакции, а не доверяется UI.

Заголовок `Idempotency-Key` — непустой ASCII 1–128 символов. Для `POST /flags`
он должен содержать UUID `client_request_id`. Повтор с тем же телом возвращает
исходной результат; повтор с другим телом — `409 IDEMPOTENCY_KEY_REUSED`.
Результат идемпотентности хранится минимум 24 часа.

## 3. Создание и жизненный цикл флага

### `POST /v1/community/flags`

Запрос:

```http
POST /v1/community/flags
Authorization: Bearer <session>
Idempotency-Key: 5705e0ed-03be-4a6f-a6f1-01f69269b130
Content-Type: application/json
```

```json
{
  "schema_version": "v1",
  "target": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
  "reason_code": "illegal_or_dangerous",
  "details": "Нет предупреждения о высокой температуре.",
  "client_request_id": "5705e0ed-03be-4a6f-a6f1-01f69269b130"
}
```

Успех `201 Created` (повтор — `200 OK`):

```json
{
  "schema_version": "v1",
  "id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677",
  "target": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
  "reason_code": "illegal_or_dangerous",
  "status": "open",
  "created_at": "2026-07-13T09:00:00Z",
  "updated_at": "2026-07-13T09:00:00Z"
}
```

Допустимые `reason_code`: `illegal_or_dangerous`, `copyright`, `spam_or_fraud`,
`harassment`, `other`; для `other` непустой `details` обязателен. Переходы:
`open → in_review → actioned|rejected`, либо `open → withdrawn` только reporter.
Решение `actioned` всегда сопровождается `moderation_action` и audit в одной
транзакции. При достижении порога автоскрытие использует тот же контракт.

### Чтение флага и захват очереди

`GET /flags/:id` возвращает безопасную проекцию, общую для reporter и
модератора; `details`, если они разрешены policy для reporter, выдаются только
в собственной жалобе. Для чужой жалобы поле не возвращается, даже если
вызывающий имеет доступ к очереди:

```json
{
  "schema_version": "v1",
  "id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677",
  "target": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
  "reason_code": "illegal_or_dangerous",
  "status": "open",
  "created_at": "2026-07-13T09:00:00Z",
  "updated_at": "2026-07-13T09:00:00Z"
}
```

`POST /flags/:id/claim` принимает `{}`. Успешный захват возвращает `200 OK`;
повтор с тем же ключом возвращает сохранённый результат и не создаёт новый
audit-факт:

```json
{
  "schema_version": "v1",
  "flag": {
    "id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677",
    "status": "in_review",
    "updated_at": "2026-07-13T09:03:00Z"
  }
}
```

### Запросы модератора

`POST /flags/:id/claim` принимает `{}` и переводит только `open` в `in_review`.
`POST /flags/:id/decision`:

```json
{
  "action_type": "hide",
  "reason_code": "spam_or_fraud",
  "details": "Ссылки ведут на повторяющиеся рекламные публикации."
}
```

`action_type`: `hide`, `restore`, `lock_thread`, `unlock_thread`, `reject_flag`.
`details` всегда непустой для ручного решения. `restore` допустим только при
активном `hide`, `unlock_thread` — только при активном `lock_thread`; `lock_thread`
нельзя применить к `post`. Успех `201 Created`:

```json
{
  "schema_version": "v1",
  "action": {
    "id": "9a62d1d1-5d78-4b58-bf4c-4b77f67f0b67",
    "type": "hide", "status": "applied",
    "target": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
    "created_at": "2026-07-13T09:05:00Z"
  },
  "flag": {"id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677", "status": "actioned"}
}
```

### Reversal

`POST /moderation/actions/:id/reversal` принимает
`{"reason":"Решение отменено после проверки контекста."}` и возвращает `200`:

```json
{
  "id": "9a62d1d1-5d78-4b58-bf4c-4b77f67f0b67",
  "status": "reversed",
  "reversed_at": "2026-07-13T10:00:00Z",
  "reversal_reason": "Решение отменено после проверки контекста."
}
```

Reversal блокирует target и исходное действие. Нельзя восстановить цель, которую
после этого отдельно скрыли; повторная отмена — `409 ACTION_ALREADY_REVERSED`.

## 4. Очередь, фильтры и аудит

`GET /moderation/queue?status=open&target_type=post&community_id=<uuid>&limit=50&cursor=<opaque>`
возвращает `items` и `next_cursor`. `limit` по умолчанию 25, максимум 100;
допустимы `status=open|in_review|actioned|rejected|withdrawn` и
`target_type=thread|post`. `community_id` для moderator игнорировать нельзя —
несоответствие scope даёт `403`. Сортировка фиксирована `(created_at desc, id desc)`;
OFFSET и глобальный count запрещены.

`GET /moderation/audit?entity_type=flag&entity_id=<uuid>&event_type=...&limit=50&cursor=...`
фильтрует `entity_type=flag|moderation_action|thread|post` и
`event_type=created|status_changed|action_applied|action_reversed|appeal_created`.
Ответ содержит только `id`, тип сущности/события, UUID актёра согласно policy,
переход статуса, redacted `metadata`, `created_at` и `next_cursor`.

Пример элемента очереди:

```json
{
  "items": [{
    "id": "1ea1c7c8-98b4-4504-90f7-60ad7aaab677",
    "target": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
    "reason_code": "spam_or_fraud", "status": "open",
    "created_at": "2026-07-13T09:00:00Z"
  }],
  "next_cursor": "eyJjcmVhdGVkX2F0Ijoi..."
}
```

## 5. Ошибки

Единая форма (`Content-Type: application/json`):

```json
{
  "error": {"code": "FLAG_ALREADY_EXISTS", "message": "Активная жалоба уже существует.", "field": null},
  "request_id": "b0b3c9f2-9d0a-4d36-a0f5-08f8be9c7a34"
}
```

| HTTP | `error.code` | Когда |
|---:|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_CURSOR` | неверный JSON, enum, UUID, limit или cursor |
| 401 | `UNAUTHORIZED` | нет действующей сессии/токена |
| 403 | `FORBIDDEN`, `SCOPE_FORBIDDEN` | нет роли или moderator вне своей community |
| 404 | `TARGET_NOT_FOUND`, `FLAG_NOT_FOUND`, `ACTION_NOT_FOUND` | цель/запись не видна вызывающему |
| 409 | `FLAG_ALREADY_EXISTS`, `IDEMPOTENCY_KEY_REUSED`, `STALE_TARGET_STATE`, `INVALID_TRANSITION`, `ACTION_ALREADY_REVERSED`, `ACTIVE_ACTION_EXISTS` | конфликт состояния/дубликат |
| 429 | `RATE_LIMITED` | превышен лимит; ответ содержит `Retry-After` |

`details`, IP, cookie, evidence и сырые секреты не попадают в логи, метрики или
публичные ответы. Метрики используют только UUID/enum и `request_id`.
