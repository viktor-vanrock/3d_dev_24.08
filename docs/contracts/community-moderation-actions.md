# Контракт `moderation_action` (MF-1417, решение MF-1437.1)

Контракт API/БД для MF-416 и `docs/design/community.moderation.md`. Источник истины для
формы команды — `apps/api/src/db/moderation-action.contract.ts`, для хранения — миграция
`20260713010000_moderation_actions.sql`. Эта ранняя миграция не является полной
канонической схемой жизненного цикла: обязательные поля статуса, ограничения
reversal и `audit_events` поставляет отдельная Data-зависимость [MF-1435](https://tasks.3mf.tech).
Запись журнала добавляется, но не редактируется и не удаляется в рамках обычного API.

## Решение MF-1437.1: статус и граница reversal

Каноническая единица решения — исходная `moderation_action`. Её доказательные
поля (`actor_user_id`, `action`, цель, причина, `created_at`, metadata) после
commit неизменяемы. У неё есть единственный жизненный цикл:

```text
applied → reversed
```

Обратный переход и любое иное значение запрещены. Сам reversal фиксируется
двумя связанными фактами в **одной транзакции**: исходная строка один раз
переходит в `reversed`, а новая применённая компенсирующая команда (например,
`restore` для `hide`, либо допустимый policy-эквивалент) содержит
`reverses_action_id` исходной строки. Разрешённое изменение полей
`status`, `reversed_at`, `reversed_by`, `reversal_reason` не является
редактированием доказательства: это единственный терминальный переход его
жизненного цикла. `audit_events` подтверждает оба факта через
`action_reversed`; исходное audit-событие не переписывается.

Так сохраняются одновременно account-derived actor identity, append-only
доказательная цепочка и возможность без двусмысленности отличить применённый
эффект от отменённого. Контракт не касается identity account↔printer,
`config_fingerprint` и не вводит P2P data-plane в v1.

## Сущность

| Поле | Значения/правило |
|---|---|
| `scope` | `community` — жалоба/апелляция участника; `moderator` — очередь сообщества; `admin` — глобальный контур |
| `actor_role` | `community`, `moderator`, `admin`; это роль в контракте команды, не замена `community_members.role` |
| `action` | `flag`, `hide`, `restore`, `lock_thread`, `dismiss_flag`, `appeal`, `resolve_appeal` |
| `target_type` | `post` или `thread`; `target_id` — UUID цели |
| `reason_code` | `illegal`, `copyright`, `spam`, `harassment`, `other` |
| `reason` | пояснение; обязательно для решения модератора и апелляции, для `flag`/`appeal` может отсутствовать только при типовой причине |
| `status` | `applied` по умолчанию или терминальный `reversed`; переход только `applied → reversed` |
| `reverses_action_id` | UUID исходной обратимой команды у новой компенсирующей записи; на один источник допустима только одна такая запись |
| `reversed_at`, `reversed_by`, `reversal_reason` | заполняются вместе только у исходной строки со `status='reversed'`; `reversed_by` — actor компенсирующей команды |
| `metadata` | JSON для доказательств/технического контекста, не источник прав |

`moderation_actions` — журнал фактов. Он не подменяет состояние `posts.status` или
`threads.status`: обработчик сначала проверяет право и состояние цели, затем в одной
транзакции меняет цель и добавляет запись. Полиморфная цель намеренна: FK на `target_id`
невозможен одновременно для `posts` и `threads`.

## Матрица разрешений

| Роль контракта | Разрешено | Запрещено |
|---|---|---|
| `community` | `flag`, `appeal` для доступной ему цели; собственная апелляция — не более одной активной | `hide`, `restore`, `lock_thread`, `dismiss_flag`, `resolve_appeal`, чужая апелляция |
| `moderator` | `hide`, `restore`, `lock_thread`, `dismiss_flag`, `resolve_appeal` в назначенном community scope | `flag` от имени другого участника, действие вне назначенного сообщества, изменение `actor_role` задним числом |
| `admin` | те же решения в глобальном scope, включая разрешение конфликтов и апелляций | создание жалобы/апелляции за другого пользователя, редактирование/удаление журнала |

Внутренняя привязка: `community_members.role in ('moderator','owner')` даёт
`actor_role='moderator'` только для соответствующего сообщества; `users.is_staff=true`
даёт `actor_role='admin'` в глобальном контуре. Участник с `community_members.role='member'`
получает `actor_role='community'`. Эти проверки выполняются сервером, поля роли из JSON
клиента не принимаются как источник авторизации.

## Обратимость, гонки и идемпотентность

`hide`, `restore`, `lock_thread` и `resolve_appeal` обратимы. `flag`,
`dismiss_flag` и `appeal` не отменяются; повторный запрос возвращает сохранённый
идемпотентный результат либо доменный конфликт. Отмена не стирает первоначальную
причину и автора.

Backend выполняет reversal в порядке блокировок `target → source action`:

1. проверяет авторизацию, принадлежность target к scope, обратимость и
   `source.status='applied'`;
2. применяет компенсирующее изменение target только если оно ещё управляется
   source action;
3. меняет source на `reversed`, добавляет компенсирующую action и audit;
4. фиксирует всё одним commit.

MF-1435 обязан поставить следующие SQL-инварианты (новой аддитивной миграцией,
не правкой уже опубликованной миграции):

```sql
status text not null default 'applied'
  check (status in ('applied', 'reversed'));

check (
  (status = 'applied'
    and reversed_at is null and reversed_by is null and reversal_reason is null)
  or
  (status = 'reversed'
    and reversed_at is not null and reversed_by is not null
    and btrim(reversal_reason) <> '')
);

create unique index moderation_actions_one_reversal_per_source_key
  on moderation_actions (reverses_action_id)
  where reverses_action_id is not null;
```

DB-trigger/права роли API дополнительно разрешают `UPDATE` action только для
набора lifecycle-полей и только при `old.status='applied'` и
`new.status='reversed'`; любые изменения доказательных полей, обратный переход
и `DELETE` отвергаются. Durable idempotency ledger имеет уникальный scope
`(actor_user_id, operation, idempotency_key)`, хранит fingerprint и ссылку на
исходный HTTP-результат. Его конфликт с иным fingerprint маппится в
`IDEMPOTENCY_KEY_REUSED`, а не в повторное выполнение mutation.

Проверка типа, цели и допустимой компенсирующей команды остаётся в транзакции:
простого `CHECK` для полиморфной цели недостаточно. Конфликт уникальности после
блокировки маппится в `ACTION_ALREADY_REVERSED`, без частичной смены target или
audit. Тот же `Idempotency-Key` и тот же fingerprint запроса возвращают ранее
сохранённый `200`-результат без второй action/audit; тот же ключ с другим
fingerprint — `409 IDEMPOTENCY_KEY_REUSED`. Хранилище ключа с TTL не менее 24
часов и связь с результатом — часть поставки MF-1435/API, а не память процесса.

## Примеры JSON

Жалоба участника:

```json
{
  "scope": "community",
  "actor_role": "community",
  "action": "flag",
  "target_type": "post",
  "target_id": "018f7c1e-7f3d-7b5f-9b1d-3c405b6a1e11",
  "reason_code": "spam",
  "reason": null
}
```

Скрытие модератором и последующая отмена:

```json
{
  "scope": "moderator",
  "actor_role": "moderator",
  "action": "hide",
  "target_type": "post",
  "target_id": "018f7c1e-7f3d-7b5f-9b1d-3c405b6a1e11",
  "reason_code": "spam",
  "reason": "Реклама вне темы",
  "reversible": true
}
```

```json
{
  "scope": "moderator",
  "actor_role": "moderator",
  "action": "restore",
  "target_type": "post",
  "target_id": "018f7c1e-7f3d-7b5f-9b1d-3c405b6a1e11",
  "reason_code": "other",
  "reason": "Апелляция подтверждена",
  "reverses_action_id": "018f7c1e-7f3d-7b5f-9b1d-3c405b6a1e12"
}
```

## Ошибки авторизации и валидации

| HTTP | `error` | Когда |
|---:|---|---|
| `401` | `unauthorized` | нет действующей сессии |
| `403` | `FORBIDDEN` | роль не может выполнять действие или scope не назначен |
| `404` | `not_found` | цель не существует или недоступна в данном контексте |
| `409` | `DUPLICATE_FLAG` / `APPEAL_ALREADY_PENDING` | повторная необратимая команда |
| `409` | `ACTION_ALREADY_REVERSED` | попытка отменить уже отменённую команду |
| `409` | `IDEMPOTENCY_KEY_REUSED` | тот же ключ передан с другим телом/fingerprint |
| `409` | `STALE_TARGET_STATE` | компенсирующее действие затёрло бы более новое независимое решение |
| `422` | `ACTION_NOT_REVERSIBLE` | reversal запрошен для необратимого типа |
| `422` | `INVALID_ACTION` / `INVALID_REASON` | неизвестное действие, цель или причина |

## Handoff Backend

1. **MF-1435 (Data):** новой dbmate-миграцией добавить status/reversal-инварианты,
   durable idempotency storage и канонические `flags`/`audit_events`; проверить
   `up → rollback → up` и передампить `schema.sql`.
2. **Backend:** принимать только значения из TypeScript-контракта; `scope` и `actor_role` вычислять по
   сессии и membership/staff, не доверять телу запроса.
3. Для mutation использовать транзакцию: проверка права → блокировка target/source →
   изменение доменной строки → status/reversal action → `audit_events`.
4. Выдавать `reversible` только для четырёх обратимых действий; клиент не делает локальную
   отмену и ждёт новую серверную запись.
5. Добавить HTTP-роуты очереди/действия/апелляции отдельной карточкой; эта поставка фиксирует
   схему, матрицу и шов, не обещает уже реализованный UI.
