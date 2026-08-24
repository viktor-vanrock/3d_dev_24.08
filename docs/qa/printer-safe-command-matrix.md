# QA-матрица safe test job: команды и replay

Документ для MF-1537. Матрица проверяет только отдельную boundary safe test job;
обычная команда принтера и физический запуск печати в этот протокол не входят.
Канонический контракт: `docs/api.public.md` (MF-1534), replay-fixture:
`docs/contracts/fixtures/publicapi.command-replay.v0.json`.

## Правила допуска

1. До каждого прогона QA фиксирует режим `mock` или `live` и ссылку на redacted
   evidence. По умолчанию используется `mock`; `live` разрешён только после
   подтверждения владельца стенда, точной модели/варианта и одноразового test job.
2. В запросе обязательно присутствует `safe_test_job: true`. Команды вне
   allowlist не должны попасть в очередь.
3. В allowlist входят только `query`, `pause`, `resume`. `start` и `stop` всегда
   проверяются как deny; неизвестные значения проверяются отдельно.
4. Для `pause` и `resume` используется opaque `Idempotency-Key`; `X-Request-Id`
   — opaque UUID. В evidence сохраняются только redacted request id, команда,
   статус, безопасный код результата и число эффектов.
5. Любая ошибка или timeout останавливает live-прогон. Rollback означает
   возврат test job в заранее согласованное безопасное состояние через
   разрешённый путь стенда; `start`, `stop`, cancel, G-code и ручное вмешательство
   в железо для этого протокола не используются.

## Матрица сценариев

| ID | Режим | Подготовка и действие | Ожидаемый результат | Evidence и stop condition |
| --- | --- | --- | --- | --- |
| QRY-01 | mock/live | Отправить `query` с safe marker | `2xx`; нормализованные `state`, `progress`, `job_id`; нет payload/секретов | Сохранить только redacted response. Лишнее поле или раскрытие секрета — stop и deny |
| CMD-01 | mock/live | Отправить `pause` с новым idempotency key | `202`; один эффект; безопасный outcome с request id | Сверить эффект с audit/trace. Второй эффект — stop |
| CMD-02 | mock/live | Отправить `resume` с новым idempotency key после согласованного pause | `202`; один эффект; состояние подтверждено отдельным query | Несовпадение состояния или повторный эффект — stop |
| DEN-01 | mock/live | Отправить `start` с safe marker | `403 command_denied`; в очереди нет команды и эффекта нет | Сохранить только код отказа. Любой `2xx` или queued — немедленный stop |
| DEN-02 | mock/live | Отправить `stop` с safe marker | `403 command_denied`; в очереди нет команды и эффекта нет | Сохранить только код отказа. Физический stop запрещён |
| DEN-03 | mock | Отправить неизвестную команду | `400 unknown_command`; в очереди нет команды | Проверять только на mock/simulator; live не нужен |
| MARK-01 | mock | Убрать `safe_test_job` или передать не-`true` | `403 safe_test_job_required`; эффектов нет | Сохранить deny reason; не повторять на live |
| DUP-01 | mock/live | Повторить тот же `pause` с тем же idempotency key | Оба ответа `202`, response одинаковый, эффектов `1`, audit effects `1` | Любой второй effect — stop; сравнить request/correlation trace |
| TMO-01 | mock/live | После server accept потерять ответ и дождаться timeout клиента; повторить тот же `resume` | Повтор возвращает тот же `202`/результат, эффектов `1`, audit effects `1` | Timeout после accept не считать deny. При неизвестном outcome сначала query |
| RET-01 | mock/live | Смоделировать потерю ответа и retry той же `pause` | Повтор идемпотентен: тот же outcome, эффектов `1` | Не отправлять новый key для retry; новый key — отдельный сценарий |
| CON-01 | mock/live | Принять `pause`, затем тем же idempotency key отправить `resume` | `409 idempotency_conflict`; эффектов `1`, audit effects `1` | Конфликт не должен менять состояние. Любой второй effect — stop |
| RBK-01 | mock/live | После каждого accepted pause/resume выполнить согласованный rollback через safe стенд | Rollback подтверждён query; повторяемость и отсутствие лишнего эффекта доказаны | При отсутствии подтверждения rollback — blocker, live прогон закрыть |

## Разделение mock и live evidence

`mock` считается достаточным для deny, duplicate, timeout, retry, conflict и
rollback-веток, а также для проверки формы redacted trace. `live` нужен только
для подтверждения факта подключения конкретного стенда и безопасного поведения
`query`/`pause`/`resume` после допуска владельца. Mock не доказывает доступность
железа, а live без redacted trace не считается evidence.

Для каждого сценария явно указывается один из результатов:

- `pass` — все ожидаемые статусы, эффекты и redaction подтверждены;
- `fail` — наблюдалось нарушение контракта, с безопасным кодом причины;
- `blocked` — не выполнено precondition, без попытки обхода ограничения;
- `not_run` — сценарий не нужен для выбранного режима.

## Redacted evidence template

Шаблон заполняется в комментарии/артефакте QA. Значения в угловых скобках —
описательные placeholders, их нельзя заменять секретами или сетевыми/серийными
идентификаторами.

```yaml
issue: MF-1537
scenario: <QRY-01|CMD-01|...>
mode: <mock|live>
observed_at: <RFC3339>
safe_job: true
command: <query|pause|resume|start|stop|unknown>
request_id: <redacted-opaque-uuid>
idempotency: <redacted-opaque-key>
http_status: <integer>
outcome: <pass|fail|blocked|not_run>
error_code: <safe-code-or-null>
effect_count: <integer>
audit_effect_count: <integer>
rollback: <confirmed|not_required|blocked>
evidence_ref: <local-fixture-or-redacted-log-reference>
blocker: <none-or-safe-description>
```

Перед публикацией QA проверяет, что в evidence отсутствуют credentials, bearer
tokens, API keys, raw payload/G-code, network addresses, serial/MAC/device
identifiers, имена пользователей и cookies. При обнаружении такого значения
артефакт удаляется/перегенерируется до публикации, а live-прогон считается
остановленным.

## Критерий приёмки

Матрица считается принятой, если все строки `mock` воспроизводимы на simulator
fixtures, allowlist и deny соответствуют `docs/api.public.md`, replay-строки
согласованы с `publicapi.command-replay.v0.json`, а итоговый evidence проходит
redaction-проверку. Live evidence добавляется отдельным прогоном только после
подтверждения safe stand; отсутствие такого подтверждения фиксируется как
конкретный blocker, а не как успешная live-проверка.
