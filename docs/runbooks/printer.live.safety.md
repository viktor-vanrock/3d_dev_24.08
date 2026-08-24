# Runbook: безопасная live-проверка safe test job (каркас, MF-1540)

**Стадия 1 — только каркас.** Этот документ фиксирует структуру и правила redaction для
будущей живой проверки `safe_test_job` на конкретном пилот-принтере. Он **не содержит и не
разрешает live-команд**: ни одна строка ниже не является инструкцией выполнить запрос к
реальному устройству. Заполнение конкретных значений (exact variant, владелец, наблюдаемый
результат) — отдельная stage 2, после того как появится подтверждённый доступ к safe test job
(зависимость [MF-1495](mention://issue/ff1aac4c-045b-447a-8a76-6c5c96c97c64)) и её собственное
review. Пока карточка/владелец stage 2 не подтвердили доступ, этот runbook не используется для
реального прогона.

Канонический контракт safe test job — не здесь: allowlist, deny-коды и command lifecycle
определены в [printer.wizard.md §4.3](../design/printer.wizard.md#43-ограниченный-safe-test-job-отдельная-control-surface-mf-1539)
и [printer.offline-command-states.md §3.1](../design/printer.offline-command-states.md#31-ограниченный-safe-test-job-mf-1539).
Сценарии и redaction-шаблон для QA-прогона — [qa/printer-safe-command-matrix.md](../qa/printer-safe-command-matrix.md).
Этот runbook — операционная обвязка поверх того же контракта (кто нажимает, в каком порядке,
что писать в evidence), не альтернативная спека.

## 1. Preconditions

Live-шаг допускается только если выполнены все пункты; отсутствие любого — `blocked`, не
попытка обхода:

- [ ] Подтверждён доступ к safe test job на **точном** exact-variant (см. §2) — не «похожая
      модель», не общий relay/платформа ([firmware.pilot.md §0.1](../infra/firmware.pilot.md)
      явно разделяет платформенное доказательство и доказательство на конкретном пилоте).
- [ ] Runtime вернул валидный маркер контракта: `safe_test_job: true`, `execution_mode`,
      `allowed_commands` — строго пересечение с `{query, pause, resume}` (иначе `unavailable`,
      не эскалация).
- [ ] Назначен единственный **владелец пилота** (см. §3) на время прогона; никто другой
      команды в этот job не отправляет.
- [ ] Согласован путь rollback (см. §6) и то, что считается безопасным исходным состоянием
      job, — до первой команды, не постфактум.
- [ ] Redaction-правила (см. §7) прочитаны исполнителем; шаблон evidence (§8) готов к
      заполнению до, а не после прогона.

## 2. Exact-variant placeholder

Live-запись **обязана** называть точную модель/вариант, не семейство. Заполняется только
владельцем пилота вместе с evidence и `updated_at`, по тому же правилу свежести
(24 часа), что и `pilot_status` в [firmware.pilot.md §0.1](../infra/firmware.pilot.md):

```yaml
exact_variant: <бренд + точная модель/вариант, например "<vendor> <model> <hw-revision-or-null>">
firmware_source: <stock|klipper-stock|custom-pilot>
updated_at: <RFC3339>
```

Плейсхолдер не заполнен намеренно. Похожая модель, платформенный relay или предыдущий пилот на
другом варианте не подставляются вместо точного значения.

## 3. Роль владельца

- **Владелец пилота** — единственный человек/агент, которому разрешено инициировать live-команду
  в рамках этого runbook на конкретном exact-variant; назначается отдельно на каждый прогон, имя
  и связь фиксируются вне этого файла (redacted evidence, не сам runbook).
- **Наблюдатель (опционально)** — может присутствовать при live-прогоне, не отправляет команды.
- Ни владелец, ни наблюдатель не получают право расширять allowlist, менять roles/permissions
  стенда или запускать `start`/`stop`/`cancel`/upload/G-code в рамках этого runbook — это вне
  границ safe test job независимо от роли исполнителя.

## 4. Allowlist: `query` / `pause` / `resume`

Тот же жёсткий allowlist, что в [printer.wizard.md §4.3](../design/printer.wizard.md#43-ограниченный-safe-test-job-отдельная-control-surface-mf-1539):

| Команда | Confirmation | Эффект | После accept |
|---|---|---|---|
| `query` | не требуется | не меняет состояние job | ничего дополнительно не нужно |
| `pause` | обязательна, с именем job и точным глаголом | одна command record с idempotency key | обязательный новый `query` для подтверждения перехода |
| `resume` | обязательна, с именем job и точным глаголом | одна command record с idempotency key | обязательный новый `query` для подтверждения перехода |

`start`, `stop`, `cancel`, upload и произвольный G-code вне этого runbook при любом исходе —
такие попытки не входят в safe test job и здесь не описываются.

## 5. Stop conditions

Любое из условий ниже немедленно останавливает live-прогон (не «продолжить и посмотреть»):

- Ответ вне allowlist или неожиданный `2xx`/`queued` на команду, которая должна быть deny.
- Второй эффект на тот же idempotency key, или эффект без соответствующей command record.
- Раскрытие в ответе/логе значения, подпадающего под §7 (credential, IP, serial, payload,
  пользовательские данные).
- `error`/`timeout` без безопасного `error_code`, либо любой сигнал, что состояние принтера
  не совпадает с ожидаемым после `ack`.
- Недоступность или истечение допуска владельца пилота, потеря связи со стендом, любое
  сомнение исполнителя в безопасности продолжения.

При срабатывании любого условия — переход сразу к §6, без повторной попытки той же команды.

## 6. Rollback

- Rollback — это возврат test job в заранее согласованное безопасное состояние через
  **уже допустимый** путь (`pause`/`resume` из allowlist и последующий `query`), не ручное
  вмешательство в железо и не команды вне allowlist.
- Rollback никогда не выполняется автоматически: после `pause` предлагается `resume` как
  отдельный следующий шаг с новой confirmation; после `resume` — `query`, подтверждающий
  согласованное состояние (та же последовательность, что в
  [printer.wizard.md §4.3.1](../design/printer.wizard.md#431-последовательность-confirmation-и-rollback)).
- Rollback считается подтверждённым только по свежему `query` после действия, не по `queued`
  или `sent`. Неподтверждённый rollback — это `blocked`/`denied` исход, который фиксируется в
  evidence, а не тихо считается успехом.
- Если rollback не подтверждается в разумное время — эскалация владельцу пилота и stop
  дальнейших команд; повторную попытку до подтверждения не отправлять.

## 7. Redaction rules

Публикуемый evidence (комментарий, коммит, артефакт) не должен содержать:

- credentials, bearer/API-токены, ключи, cookies;
- IP-адреса, hostname/DNS стенда, MAC/serial/device ID;
- сырые payload, G-code или произвольный ответ API целиком;
- имена/контакты пользователей и любые персональные данные;
- любое значение, которое можно было бы использовать для повторного доступа к стенду без
  отдельного допуска.

Допустимо: redacted request id / opaque idempotency key, безопасный `error_code`, нормализованный
`state`/`progress`, число эффектов, факт подтверждения rollback, ссылка на redacted-фикстуру.
Если сомнение — значение не публикуется, а прогон считается не имеющим evidence для этого поля
(та же граница, что в [qa/printer-safe-command-matrix.md](../qa/printer-safe-command-matrix.md)).
При обнаружении утечки после публикации — артефакт удаляется/перегенерируется, а прогон
считается остановленным на этом шаге, не «частично успешным».

## 8. Mock-only путь

Пока exact-variant (§2) и допуск владельца пилота не подтверждены, единственный разрешённый
путь — `execution_mode: mock_only` на simulator/fixture:

- Тот же allowlist (`query`/`pause`/`resume`) и та же структура evidence (§9), но
  `mode: mock` и явная пометка, что результат не доказывает физическое поведение устройства.
- Mock подтверждает только форму контракта (allowlist, deny-коды, redaction, idempotency),
  не доступность или безопасность железа — тот же принцип, что в
  [qa/printer-safe-command-matrix.md «Разделение mock и live evidence»](../qa/printer-safe-command-matrix.md#разделение-mock-и-live-evidence).
- Переход с mock-only на live возможен только через отдельное явное решение владельца пилота
  после выполнения всех §1 preconditions — mock-прогон сам по себе не открывает live.

## 9. Место для observed result

Каждый прогон (mock или live) фиксируется отдельной записью по этому шаблону — либо в
комментарии к карточке stage 2, либо в отдельном evidence-файле со ссылкой отсюда; в этот
runbook значения не вписываются напрямую:

```yaml
issue: <MF-issue-этого-прогона>
runbook: docs/runbooks/printer.live.safety.md
exact_variant: <см. §2, или "not_set" для mock>
mode: <mock|live>
observed_at: <RFC3339>
owner: <redacted-ссылка-на-владельца-пилота, не имя/контакт в открытом виде>
command: <query|pause|resume>
outcome: <pass|fail|blocked|not_run>
stop_condition_triggered: <none-or-которое-из-§5>
rollback: <confirmed|not_required|blocked>
evidence_ref: <redacted-лог-или-fixture-ссылка>
notes: <только redaction-safe текст>
```

Пустой прогон (`not_run`) — валидное состояние этого документа до stage 2; он не заменяется
предположением об успехе.

## 10. Связи и lineage

Основания: [../epics/v1.device.cloud.md](../epics/v1.device.cloud.md),
[../epics/printer.support.md](../epics/printer.support.md),
[../design/printer.wizard.md §4.3](../design/printer.wizard.md#43-ограниченный-safe-test-job-отдельная-control-surface-mf-1539).
Смежные доки: [../design/printer.offline-command-states.md §3.1](../design/printer.offline-command-states.md#31-ограниченный-safe-test-job-mf-1539),
[../qa/printer-safe-command-matrix.md](../qa/printer-safe-command-matrix.md),
[../infra/firmware.pilot.md](../infra/firmware.pilot.md) (статус пилотов и правило свежести
`exact_variant`). Финальная версия (заполненные §2/§3/§9, снятие ограничения mock-only) —
отдельная stage 2 после подтверждённого доступа к safe test job; этот файл в stage 1 не
редактируется под предлогом «уточнить», пока такого доступа нет.
