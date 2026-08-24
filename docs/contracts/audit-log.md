# Канонический `audit_event` и доказательная цепочка (MF-1417)

Статус: контракт для Data/Back. Документ не создаёт новую миграцию сам по себе:
существующий `audit_events` контур модерации и будущие журналы устройств должны
выдавать один и тот же envelope. Источник истины — append-only запись в Postgres,
а не лог приложения, метрика или текущее состояние объекта.

Основания: [MF-416](https://tasks.3mf.tech), MF-414/MF-415,
`docs/issues/007.database.design.md`,
[`docs/contracts/community-moderation.md`](community-moderation.md),
[`docs/contracts/community.antiabuse.v1.md`](community.antiabuse.v1.md).

## 1. Границы и обязательные инварианты

`audit_event` — факт уже принятого результата или перехода состояния. Он не
является командой, очередью, пользовательской аналитикой или заменой
`device_telemetry`. Событие записывается в той же транзакции, что и изменение,
которое оно доказывает; если транзакция откатилась, факта нет.

Обязательные правила:

1. Событие неизменно: приложение не имеет `UPDATE`/`DELETE`; исправление — новое
   событие с `causation_id` на ошибочный факт.
2. У каждого события есть один `event_id`, один `event_type`, один субъект и
   одна причина. Нельзя записывать произвольное сообщение вместо типа.
3. `actor` отвечает на «кто инициировал», `subject` — «кого/что затронуло».
   Системное действие имеет `actor.kind = system` и машиночитаемый `actor.id`.
4. Доказательство содержит ссылки и хэши, но не секреты и не копию контента.
   Наличие evidence не означает, что файл доступен читателю.
5. Повтор доставки с тем же `idempotency_key` возвращает исходный результат и
   не создаёт второй факт. Такой повтор не должен менять `sequence`.
6. Время события — серверное UTC; часы клиента не используются для порядка.

Один источник истины означает: `flags`, `moderation_actions` и
`audit_events` остаются доменными таблицами, но `audit_events` является
каноническим журналом фактов. `device_audit_log` при миграции/адаптере должен
сохранять свои device-поля, но публиковать те же поля envelope и не заводить
второй общий журнал.

## 2. Каноническая схема

Минимальная SQL-модель (конкретные enum/check могут быть реализованы в API и
Postgres; UUID — UUID v4, как в текущей схеме):

| Поле | Тип | Требование |
|---|---|---|
| `event_id` | UUID | PK, уникальный идентификатор факта |
| `schema_version` | text | `audit.v1`; новые поля — additive |
| `event_type` | text | стабильный ASCII-код из таксономии домена |
| `actor` | object | `kind=user\|agent\|service\|system`, `id` nullable только для `system`; `display_name` не каноничен |
| `subject` | object | `type` и UUID `id`; объект/цель действия |
| `aggregate` | object | `type`, UUID `id`, `sequence` — монотонный порядок внутри aggregate |
| `action` | object | `type`, `from_state`, `to_state`; состояние обязательно для перехода |
| `occurred_at` | timestamptz | серверное время факта, UTC |
| `recorded_at` | timestamptz | время фиксации в журнале, UTC; `recorded_at >= occurred_at` допускается с задержкой |
| `correlation_id` | UUID | общий workflow/request/trace; один флаг и его решения связаны им |
| `causation_id` | UUID | непосредственный предыдущий факт; nullable только для корневого события |
| `idempotency_key` | text | стабильный ключ попытки записи, scoped на `producer`; не секрет |
| `producer` | text | сервис/версия, например `community-api@v1` |
| `evidence` | array | ноль или больше безопасных ссылок-доказательств (§4) |
| `metadata` | object | allowlist redacted-полей; никогда не произвольный client JSON |

Рекомендуемый уникальный ключ: `(producer, idempotency_key)`. Рекомендуемые
индексы: `(aggregate.type, aggregate.id, aggregate.sequence)`,
`(correlation_id, occurred_at, event_id)`, `(subject.type, subject.id,
occurred_at desc)`, `(event_type, recorded_at desc)`. `sequence` начинается с
`0` или `1` по выбранному агрегату и увеличивается только в транзакции под
блокировкой агрегата. Пропуск sequence — наблюдаемый gap, а не повод
перенумеровывать историю.

Пример envelope:

```json
{
  "event_id": "8c5f4a9f-4ea6-49bb-a4ed-48c3f9f6bd8e",
  "schema_version": "audit.v1",
  "event_type": "moderation.action_applied",
  "actor": {"kind": "user", "id": "0d4f2d72-b7cc-4e4f-997e-2a6e6ee6c7c1"},
  "subject": {"type": "post", "id": "2b7165fa-601e-4a66-9c28-6b5d5f3b1691"},
  "aggregate": {
    "type": "moderation_action",
    "id": "c4f38f31-7d14-42cf-8e54-bb4baf8b9fc2",
    "sequence": 1
  },
  "action": {"type": "hide", "from_state": "visible", "to_state": "hidden"},
  "occurred_at": "2026-07-13T09:00:00.123Z",
  "recorded_at": "2026-07-13T09:00:00.130Z",
  "correlation_id": "5705e0ed-03be-4a6f-a6f1-01f69269b130",
  "causation_id": "f7e2e2d5-9e30-4ac8-8cee-1cfaed7c4a01",
  "idempotency_key": "moderation-action:c4f38f31-7d14-42cf-8e54-bb4baf8b9fc2:apply",
  "producer": "community-api@v1",
  "evidence": [{
    "kind": "request",
    "ref": "request:5705e0ed-03be-4a6f-a6f1-01f69269b130",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }],
  "metadata": {"reason_code": "illegal_or_dangerous", "target_type": "post"}
}
```

`metadata` не хранит `details`, cookie, IP, user-agent, Bearer/API-key, signed
URL, полный текст поста или произвольные поля клиента. Если нужен текст причины,
он остаётся в доменной записи с её policy-доступом; в audit попадает только
`reason_code`.

## 3. Таксономия и доказательная цепочка

На первом этапе обязательны события модерации:

| `event_type` | `subject` | Когда создаётся |
|---|---|---|
| `moderation.flag_created` | `thread`/`post` | валидный флаг принят в транзакции |
| `moderation.flag_state_changed` | `flag` | `open → in_review/actioned/rejected/withdrawn` |
| `moderation.action_applied` | `thread`/`post` | visibility/lock реально изменены |
| `moderation.action_reversed` | `thread`/`post` | исходное действие отменено отдельной транзакцией |
| `moderation.appeal_created` | `flag`/`moderation_action` | принято апелляционное обращение |

Производитель может добавлять доменные семейства (`device.*`, `account.*`), но
не меняет смысл envelope. Тип должен быть зарегистрирован в контракте домена и
иметь потребителя/критерий SLO; «событие на всякий случай» запрещено.

Каноническая цепочка для флага:

```text
flag_created
  └─(causation_id)→ flag_state_changed: open → in_review
       └─(causation_id)→ action_applied: visible → hidden
            └─(causation_id)→ flag_state_changed: in_review → actioned
                 └─(опционально)→ action_reversed: hidden → visible
```

Все узлы цепочки имеют один `correlation_id` (равный `request_id`/workflow ID),
а `causation_id` указывает ровно на непосредственный родитель. Для автоскрытия
допустим корневой `action_applied`, если пороговое решение не было отдельным
пользовательским флагом; в `metadata` фиксируется `trigger=threshold`, а не
создаётся фиктивный actor.

Переход `flag → action → event` атомарен: нельзя перевести flag в `actioned`
без созданного `moderation_action` и соответствующего события; нельзя создать
`action_applied`, если изменение target не закоммичено. Reversal никогда не
переписывает исходное событие.

## 4. Evidence и приватность

`evidence` — typed reference, а не вложение. Допустимые `kind`: `request`,
`snapshot`, `db_record`, `operator_note`, `external_artifact`. Поля:

| Поле | Политика |
|---|---|
| `ref` | opaque ID/внутренняя ссылка без секрета и signed URL |
| `sha256` | хэш байтов/канонического JSON для проверки неизменности; не хэш ПДн в открытом виде без privacy-решения |
| `captured_at` | серверное UTC-время получения |
| `redaction` | перечисление удалённых классов, например `content`, `ip`, `credential` |
| `retention_class` | `audit`, `incident`, `legal_hold`; не продлевает TTL сам по себе |

Файл доказательства хранится отдельно, в приватном хранилище с ACL и сроком,
если он действительно нужен расследованию. Audit содержит только `ref` и
хэш. Публичного endpoint для evidence нет; moderator видит только evidence
своей цели, staff/privacy — по роли и цели расследования.

Минимизация: UUID, enum, переход, времена, request/correlation ID и безопасные
метаданные. При удалении/анонимизации аккаунта display-проекция и operator note
анонимизируются по privacy policy, но UUID события сохраняется для целостности
цепочки и legal hold. Секреты, cookie, токены, IP и полные пользовательские
тексты не попадают ни в audit, ни в логи, ни в метрики.

Базовый retention: audit-факты — 12 месяцев после закрытия расследования;
evidence-файлы — 90 дней после закрытия, если нет `legal_hold`; legal hold
приостанавливает оба срока. Владелец privacy может изменить сроки отдельным
решением и миграцией/операционной политикой. Удаление после TTL — только
пакетной задачей с метрикой удалённых строк и без удаления фактов под hold.

## 5. Время, порядок и отказоустойчивость

- `occurred_at` отражает момент доменного действия, `recorded_at` — commit/insert.
  Задержка `recorded_at - occurred_at` измеряется; отрицательное время запрещено.
- Порядок внутри агрегата определяется `(aggregate.sequence, event_id)`, не
  временем клиента. Между агрегатами общего порядка нет; для него используется
  `correlation_id` и граф `causation_id`.
- Consumer хранит checkpoint по `(aggregate.type, aggregate.id, sequence)` и
  повторно читает gap. Событие с повторным `(producer, idempotency_key)` — replay,
  не новый факт; payload с тем же ключом, но другим хэшем — ошибка конфликта.
- При недоступном audit-хранилище mutation не подтверждается (fail-closed для
  модерации и security-действий). Read-only выдача может показать stale-данные с
  явным `audit_lag`; это не разрешает выполнять действие.

Минимальная наблюдаемость:

| Сигнал | Потребитель | SLO/порог |
|---|---|---|
| `audit_write_total{event_type,outcome}` | Back/On-call | error < 0,1% за 15 мин |
| `audit_write_latency_seconds` | Back/On-call | p95 < 500 ms за 15 мин |
| `audit_chain_gap_total` | Data/On-call | 0 необъяснимых gap за 15 мин |
| `audit_idempotency_replay_total` | Back | не более 5% записей за 15 мин; всплеск — расследовать |
| `audit_retention_delete_total` | Privacy/Ops | каждая операция имеет ненулевой результат или явный `no-op` |

В labels только низкокардинальные enum: `event_type`, `producer`, `outcome`.
Нельзя помещать UUID, `correlation_id`, `subject_id` или текст причины в labels.

## 6. Приёмка и handoff

Контракт считается реализованным, когда проверены:

- повтор с тем же ключом возвращает один `event_id`, а изменённый payload даёт
  `IDEMPOTENCY_KEY_REUSED`;
- транзакция flag/action/visibility/event атомарна, rollback не оставляет event;
- конкурентные решения сериализуются по aggregate, sequence не дублируется и gap
  обнаружим запросом/метрикой;
- цепочка `flag_created → action_applied → action_reversed` читается по
  `correlation_id` и `causation_id`, включая системный actor;
- UPDATE/DELETE audit ролью API запрещены; evidence без raw secret, IP, cookie,
  token и полного контента;
- retention не удаляет записи под legal hold, а privacy-выдача не раскрывает
  чужой target/evidence;
- fixture ниже проходит JSON-валидацию и интеграционный тест append-only.

Минимальный fixture для теста:

```json
{
  "event_id": "00000000-0000-4000-8000-000000000005",
  "schema_version": "audit.v1",
  "event_type": "moderation.flag_created",
  "actor": {"kind": "user", "id": "00000000-0000-4000-8000-000000000001"},
  "subject": {"type": "post", "id": "00000000-0000-4000-8000-000000000002"},
  "aggregate": {"type": "flag", "id": "00000000-0000-4000-8000-000000000003", "sequence": 1},
  "action": {"type": "create", "from_state": null, "to_state": "open"},
  "occurred_at": "2026-07-13T09:00:00.123Z",
  "recorded_at": "2026-07-13T09:00:00.130Z",
  "correlation_id": "00000000-0000-4000-8000-000000000004",
  "causation_id": null,
  "idempotency_key": "flag:00000000-0000-4000-8000-000000000003:create",
  "producer": "community-api@v1",
  "evidence": [],
  "metadata": {"reason_code": "spam_or_fraud"}
}
```

Следующий исполнитель Back/Data переносит envelope в миграцию и API-контракт
MF-1417; UI не читает Postgres напрямую. Релею устройств нужно согласовать
`device.*` event types и `sequence` с Telemetry Steward до записи runtime-фактов.
