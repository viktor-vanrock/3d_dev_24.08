# Честные состояния управления, G-code и связи принтера

← [Design](readme.md) · [экран `/printer/:id`](printer.face.md) ·
[парк](park.md) · [runtime и relay](../architecture/printer.server.md) ·
[публичный API](../api.public.md) · [модель данных](../epics/domain.model.md).

**Статус документа.** Design handoff для Front по карточке **MF-1483**,
эпик **MF-26**. Он развивает общую карту MF-1507, не меняет wire-протокол и
не объявляет недоставленную команду выполненной. Основания: готовая
агентская сторона pause/resume/cancel (**MF-844**), файловый протокол с
докачкой (**MF-845**) и текущая живая страница (**MF-953**).

## 1. Граница и правило истины

Страница `/printer/:id` показывает конкретное пользовательское устройство,
не каталоговую модель и не локальный экран прошивки. Два независимых
вопроса нельзя склеивать в один бейдж:

| Ось | Вопрос для человека | Источник | Нельзя делать |
|---|---|---|---|
| Связность | Свежи ли телеметрия и удалённый канал? | live snapshot: `live`, `state`, `state_updated_at`, `last_seen_at`, `seq` | Называть старые температуру/прогресс live-данными |
| Команда | Выполнил ли принтер именно это действие? | запись команды по `command_id` и последующий ACK/error | Приравнивать HTTP `202` или нажатие кнопки к успеху |
| Передача файла | Дошёл ли G-code до принтера и началась ли печать? | запись по `transfer_id`, `next_seq`, bytes и `file_complete`/`file_error` | Считать окончание browser-upload успешной загрузкой на принтер |

Текущий `POST /me/printers/:id/commands`/`POST /v0/printers/:id/commands`
может вернуть только `202 { id, status: "queued" }`; в публичном API также
описаны исторические `acked`/`rejected`. Это подтверждает постановку в
очередь, но не delivery и не исполнение. Пока Back/Relay не отдают поля из
§7, Front показывает только «Команда в очереди; выполнение не подтверждено».
Нельзя локально вывести `sent`, `ack` или `timeout` по таймеру.

**Единый пользовательский глагол:** «Пауза» → «Пауза в очереди» → «Пауза
подтверждена». Название не заменяется техническим `command_id`; ID доступен
лишь в раскрытых подробностях для поддержки.

## 2. Связность устройства

В шапке `StatusPill`, рядом с action-row и под последним snapshot всегда
есть понятный текст и время. Цвет и анимация сами по себе не несут смысл.

### 2.1 Правило одного статуса и двух независимых осей (MF-1498)

`StatusPill` связи — discriminated state, а не набор одновременно видимых
флагов. В каждый момент Front выбирает ровно один из `online`, `offline`,
`stale`, `reconnecting`, `revoked` или `error`; при подтверждённом новом
snapshot разрешён краткий `synced`, который после объявления превращается в
`online`. Поэтому `online` очищает offline/reconnecting banner и stale-label,
а `synced` нельзя получить одним HTTP-успехом без нового `seq` и
`state_updated_at`.

Команда — вторая ось. `command_blocked` означает, что запрос не создан и
`command_id` отсутствует; `command_queued` существует только после
подтверждённого API `202 { id, status: "queued" }`. Очередь не подменяет
offline и не доказывает delivery/исполнение. Полная copy-матрица, действие и
выход для всех восьми состояний —
[printer.wizard.md §4.2.3](printer.wizard.md#423-связь-и-команда-взаимоисключающая-матрица-mf-1498).

| Состояние | Условие Front | Текст | Команды/данные | Recovery |
|---|---|---|---|---|
| `online` | `live=true` и свежий server snapshot | «Принтер на связи» + «обновлено {state_updated_at}» | Действия доступны только роли и capability allow-list; значения без пометки устаревания | Обычный экран |
| `stale` | Сервер явно пометил snapshot устаревшим **или** не прислал более свежий `seq` до `stale_after_at` | «Данные устарели; последнее обновление {state_updated_at}» | Температуры/прогресс остаются с временем, remote-команды и upload заблокированы | «Обновить статус»; дождаться нового `seq` |
| `offline` | `state="offline"` или `live=false`, без причины отзыва | «Нет связи с принтером» + `last_seen_at`, если есть | Нет live-телеметрии; remote-команды и upload заблокированы, не поставлены в скрытую очередь | «Проверить связь»; после `online` перечитать незавершённые операции |
| `reconnecting` | После offline/stale идёт восстановление, но свежего snapshot ещё нет | «Восстанавливаем связь…» | Кнопки остаются заблокированы; старые показатели подписаны временем | Показать «Проверить снова» после server deadline, не бесконечный спиннер |
| `revoked` | безопасный код `revoked`/`credential_rejected` | «Доступ агента отозван» | Никакого управления, upload и авто-retry; старые данные не выдаются за live | Owner: «Подключить заново» (новый enroll); остальные: текст из §6 |
| `error` | API передал безопасную причину канала/устройства | «Управление недоступно: {reason}» | Не скрывать кнопки бессловесно; не показывать credential, токен, LAN URL или raw diagnostic | Только действие, названное причиной |

`offline`, `stale`, `reconnecting` и `revoked` — разные состояния. Отзыв
не маскируется под сетевой сбой и не предлагает «Повторить»; повторный
enroll — явное действие владельца. Локальный киоск может показывать отдельную
кнопку «Остановить локально», только если у него действительно есть локальный
driver; портал никогда не подменяет ею remote-команду.

## 3. Pause, resume и cancel: конечный автомат

### 3.1 Ограниченный `safe test job` (MF-1539)

Этот подраздел уточняет только специальный QA/операторский режим из
[printer.wizard.md §4.3](printer.wizard.md#43-ограниченный-safe-test-job-отдельная-control-surface-mf-1539).
Он не расширяет обычный command contract и не делает `cancel` частью test
job. Режим возникает только при явной проекции runtime/API:

```text
safe_test_job: true
execution_mode: live | mock_only
allowed_commands: [query, pause, resume]
```

Это требуемые поля контракта, не заявление, что они уже есть в текущем API.
Отсутствующий, невалидный или неизвестный marker/список команд Front трактует
как `unavailable`; нельзя собрать режим из id принтера, support level, имени
job, роли или предыдущего удачного запроса. `execution_mode=mock_only`
обязателен для mock evidence и всегда остаётся отличимым от `live`.
Front жёстко пересекает `allowed_commands` с `{query, pause, resume}`. Любое
добавленное `start`, `stop` либо неизвестное значение — contract mismatch и
`unavailable` с blocker владельцу контракта; это не повод расширить UI.

| Вход / runtime-факт | UI mapping | Разрешённый эффект |
|---|---|---|
| Свежие marker+allowlist и `query` | `available` + `restricted`; кнопка «Проверить статус» | Новый snapshot без изменения job. |
| Свежие marker+allowlist и `pause`/`resume`, разрешённые ролью и текущим состоянием | `available` + `restricted`; точный action после confirmation | Создать ровно одну обычную command record с idempotency key. |
| `start`, `stop`, `cancel`, upload, G-code или команда вне allowlist | `restricted`; при попытке снаружи — `denied` | Ноль command record и ноль эффекта; соответствующие control не рендерятся. |
| `403 command_denied` / `403 safe_test_job_required` / `403 role_forbidden` / `400 unknown_command` | `denied` с безопасным кодом и recovery | Не считать transient error и не auto-retry. |
| `state=stale`, `offline`, reconnect до свежего snapshot | `stale`/`offline`; command axis — `command_blocked` | Не создавать queue; доступно только обновление/проверка связи. |
| `execution_mode=mock_only` | `mock-only` в дополнение к lifecycle | Fixture может подтвердить UI/contract mapping, но не live effect и не доступ к железу. |

Для `pause`/`resume` применяются уже описанные `queued → sent → ack|error|
timeout` и восстановление по `command_id`. Отдельное требование safe test job:
после `ack` обязательно выполнить новый `query`; только этот свежий snapshot
может показать переход job в paused/running и подтвердить rollback. Повтор
тем же ключом возвращает тот же outcome; новый ключ — новая явная команда.
При client timeout после accept сначала `query`, затем восстановление по
`command_id`; не отправлять обратное действие наугад.

Для каждой команды создаётся самостоятельная карточка у исходной кнопки.
`cancel` здесь — отмена печати; для wire/API текущий `stop` может быть
нормализован этим пользовательским названием только после явного решения
Back. Не заменять одно другим «для удобства».

| UI-state | Переход/доказательство | Текст | Primary action | Запрещено |
|---|---|---|---|---|
| `ready` | Нет активной операции | «Готово к действию» | «Пауза» / «Продолжить» / «Отменить печать» | Показывать действие при запрещённой роли или capability |
| `confirming` | Пользователь открыл подтверждение | «Подтвердите: {действие}» | «Подтвердить {действие}» / «Назад» | Отправлять до явного подтверждения |
| `queued` | API принял запись: `status="queued"`, есть `command_id` | «{Действие} в очереди; выполнение не подтверждено» | «Проверить статус»; «Отменить команду» только при API-policy | Менять state принтера, обещать доставку |
| `sent` | Relay подтвердил выдачу command frame агенту: есть `sent_at` | «Команда отправлена агенту; ждём подтверждение принтера» | «Проверить статус» | Называть команду исполненной |
| `ack` | Пришёл `command_ack`, а контракт явно классифицирует его как выполнение; сохранены `ack_at` и `correlation_id` | «Принтер подтвердил: {действие}» + время | Следующее контекстное действие | Считать `ack` окончанием печати или менять телеметрию без нового snapshot |
| `error` | `command_error`/terminal `failed` с безопасным `error_code` | «Команда не выполнена: {reason}» | «Повторить» только если allow-list пометил повтор безопасным; иначе «Разобраться» | Автоповтор, raw error, optimistic success |
| `timeout` | Наступил server `deadline_at`, а terminal outcome не пришёл | «Подтверждение не получено. Состояние принтера неизвестно» | «Проверить статус»; после свежего snapshot — новый явный запуск | Самостоятельно повторять команду или говорить «Ошибка исполнения» |
| `cancelled` | API подтвердил отмену именно очередной команды | «Команда отменена» | «Закрыть» / новый явный запуск | Возвращать исходную команду автоматически |

Переходы: `ready → confirming → queued → sent → ack|error|timeout`; из
`queued|sent` допустим `cancelled` только при подтверждённой отмене. После
reload/reconnect карточка восстанавливается по `command_id`; новый запрос не
создаётся из-за потерянного ответа. После `online` Front сначала запрашивает
исход всех `queued|sent|timeout`, затем показывает новый snapshot. Переход в
`online` не означает ACK.

**Подтверждения.** `cancel` печати, запуск печати и произвольный G-code всегда
требуют confirmation dialog. `pause` и `resume` также используют confirmation
на удалённом устройстве; это безопаснее, чем незаметный тап в состоянии с
неопределённой задержкой. В диалоге явно названы принтер и действие; primary
ровно один. Деструктивный `cancel` остаётся коралловым, а не зелёным CTA.

## 4. G-code: выбор, проверка, передача и старт

Файловая передача — не команда и имеет отдельную карточку. Основание MF-845:
wire-кадры `file_start`/`file_chunk` используют `transferId`, монотонный
`seq` и `nextSeq`; агент сохраняет state на диске, умеет продолжить transfer
и завершает его только `file_complete` либо `file_error`. Значение прогресса
берётся из `uploaded_bytes / size_bytes`, а не из browser progress.

| Состояние | Условие/поля | Текст и UI | Разрешено | Нельзя |
|---|---|---|---|---|
| `file_idle` | Файл не выбран | «Выберите файл G-code» | «Выбрать файл» | Обещать загрузку до выбора |
| `file_validating` | После выбора, до server validation | «Проверяем файл…» | Отменить выбор | Стартовать передачу |
| `file_invalid` | Неверное расширение/имя, размер, checksum или server validation | «Файл не подходит: {reason}» | «Выбрать другой файл» | Показывать технический ответ или продолжать |
| `uploading` | Есть `transfer_id`, `uploaded_bytes`, `size_bytes`, `next_seq` | «Загружаем на принтер: {n}%» + передано/всего | «Приостановить передачу» только если API поддержал | Называть файл доступным на принтере до `file_complete` |
| `network_paused` | Связь пропала при живом transfer | «Передача приостановлена; сохранено {n}%» | «Возобновить», когда `online` | Сбросить `transfer_id` или начать новый файл автоматически |
| `resuming` | Переоткрыт тот же transfer, ожидается `next_seq` | «Возобновляем загрузку…» | «Отменить передачу», если policy | Начать с нуля без `transfer_id` |
| `uploaded` | `file_complete`, есть `stored_as` | «Файл загружен на принтер» | «Запустить печать» | Писать «Печать началась» |
| `upload_error` | `file_error` с безопасным `code`; показать `next_seq`, если он есть | «Загрузка не завершена: {reason}» | «Возобновить» при `next_seq`; иначе «Выбрать файл заново» | Удалять возможность докачки или скрывать причину |
| `start_confirming` | Файл `uploaded`, пользователь выбрал запуск | «Запустить печать файла {file_name} на {printer_name}?» | «Запустить печать» / «Назад» | Запуск без confirmation |
| `start_queued` | Запуск принят, но нет command ACK | «Запуск в очереди; печать не подтверждена» | Карточка команды §3 | Переключать принтер в `printing` до свежего snapshot |

Принятый тип — `.gcode`; имя показывается только как basename. Для MVP Front
не обещает размерный предел, кроме того что server обязан принять целевой
файл не менее 100 МБ. Агентский максимум 1 GiB — технический guard, а не
пользовательское обещание без API-policy. `sha256`, если API его вернул,
отображается только в технических подробностях, не в основной копии.

Если файл был загружен с `start_print=true`, UI всё равно проходит
`uploaded → start_queued → ack|error|timeout`: `file_complete` доказывает
хранение файла, но не начало печати.

## 5. Матрица ролей и отказов

API — источник разрешения; доступная на вид кнопка никогда не заменяет
server-side role/capability check. Роли из `device_shares`: owner, operator,
viewer, guest. Неавторизованный посетитель считается guest для копирайта, но
не получает данные устройства.

| Роль | Видеть live/историю | Pause/resume/cancel | Upload/start/G-code | Текст при отказе | Recovery |
|---|---|---|---|---|---|
| `owner` | Да | Да, если `online` и capability есть | Да, с confirmation | — | Связь: проверить/enroll; capability: объяснить недоступность |
| `operator` | Да | Да, если `online` и capability есть | Да, с confirmation | — | Проверить связь или обратиться к owner за изменением доступа |
| `viewer` | Да, с честной меткой stale/offline | Нет | Нет | «У вас режим просмотра. Управлять принтером может владелец или оператор.» | «Запросить доступ» (если workflow доступен), иначе обратиться к owner |
| `guest` | Нет персональных данных и live-контроля | Нет | Нет | «Войдите, чтобы увидеть этот принтер. Управление доступно владельцу и оператору.» | «Войти»; гостевой QR-сценарий — отдельный контракт, не прямой control |

`403 role_forbidden`, `403 command_denied`, отсутствие capability и `404` не
смешиваются. Для своих `viewer/guest` показывается текст выше; чужой/неизвестный
принтер остаётся «Принтер не найден», без раскрытия владения. На revoke даже
owner/operator не получают попытку продолжить старую операцию: требуется
новый enroll владельца.

## 6. Размещение, доступность и motion

- **Desktop/tablet (≥768 px):** status и время — в шапке карточки; рядом с
  action-row только текущая карточка команды/передачи. История и technical
  details — раскрываемый второй слой.
- **Mobile (<768 px):** сначала состояние связи и время, затем текущая
  операция, после неё доступные действия. Причина, имя файла и время не
  обрезаются; подробности раскрываются нативной кнопкой.
- Для изменения outcome используем уместный `aria-live`: обычный статус —
  `polite`, отказ/ошибка — `alert`/assertive ровно один раз. Не озвучивать
  каждый процент передачи.
- Все действия — нативные `<button>`, видимый `:focus-visible`, touch target
  не менее 48 px. Disabled control не является единственным объяснением:
  причина видна рядом и доступна screen reader.
- Текст + иконка + semantic tone обязательны; контраст обычного текста не
  ниже 4.5:1, значимых иконок/focus-ring — 3:1. Motion не сигнализирует ACK
  и отключается через `prefers-reduced-motion`.

## 7. Контракт, который нужен Front

Это **требуемая нормализованная проекция**, не заявление о наличии всех
полей в текущем API. До её публикации Front реализует только уже доказанные
`live`, `state`, `state_updated_at`, `id`, `status="queued"` и честные
blocked-copy. Back/Relay должны вернуть versioned schema/fixture.

| Сущность | Поля, которые читает Front | Правило маппинга |
|---|---|---|
| Live snapshot | `live`, `state`, `state_updated_at`, `last_seen_at`, `seq`, `stale_after_at?`, `rejection?` | `id` принтера не является доказательством связи; `state` без свежести не равен `online` |
| Команда | `command_id` (текущий `id` нормализуется в него), `kind`, `status`, `created_at`, `sent_at?`, `ack_at?`, `deadline_at?`, `error_code?`, `error_message?`, `correlation_id?` | raw `queued` → UI `queued`; `acked` → `ack` только при явном semantic contract; terminal error → `error` |
| Передача | `transfer_id`, `file_name`, `size_bytes`, `uploaded_bytes`, `next_seq`, `sha256?`, `status`, `stored_as?`, `error_code?`, `deadline_at?` | `% = uploaded_bytes / size_bytes`; `file_complete` → `uploaded`; `file_error` → `upload_error` |
| Permissions | `role`, `capabilities`, `denial_reason?` | API-гейт первичен; Front не выводит role из link source или UI |

Запрещённые догадки: `HTTP 202 ≠ sent`, `command_ack ≠ printing`, reconnect
`≠ ack`, `file_complete ≠ start`, локальный таймер `≠ timeout` без
`deadline_at`. Любое незнакомое значение маппится в «Статус пока неизвестен»
с «Проверить статус», а не в success.

## 8. Связь с мастером `/park/add` и граница NAT (MF-1489)

Карта состояний от выбора уровня до первой печати находится в
[printer.wizard.md §4.2](printer.wizard.md#42-единая-карта-состояний-parkadd--lanenroll--первая-печать-mf-1489).
Этот документ — source of truth для этапа после перехода в `/printer/:id`;
мастер не имеет права называть загрузку или старт успешными раньше фактов
ниже.

| Переход из мастера | Единственный достаточный факт | Копия, которую Front может показать | Владелец при несовпадении |
|---|---|---|---|
| LAN/enroll → устройство в парке | LAN success или подтверждённый agent connect для конкретного `user_printer.id` | «Принтер найден» / «Агент на связи» | Bridge/Fleet отдаёт факт; Front не должен создавать success по таймеру. |
| Устройство в парке → файл готов | `file_complete` и `stored_as` | «Файл загружен на принтер» | Bridge/Relay за delivery-факт; Front за точный mapping. |
| Файл готов → первая печать | Свежий snapshot `printing` после command ACK; `202`, ACK и `file_complete` сами по себе недостаточны | До snapshot: «Запуск в очереди; печать не подтверждена»; после него: «Печать началась» | Bridge/Fleet за snapshot/ACK; Front за запрет optimistic-copy. |
| `managed-local` потерял доступность | Browser/local LAN outcome, не server probe | «Этот способ работает только в вашей сети. Проверьте Wi‑Fi и доступность Moonraker.» | Front не называет это серверной ошибкой; Bridge не подменяет его облачной проверкой. |
| Bridge/Fleet недоступен или credential отозван | Нормализованный `offline`/`revoked`, без raw diagnostic | «Нет связи с порталом» или «Доступ агента отозван» — разные действия | Bridge/Fleet классифицирует факт; Front сохраняет эту разницу в copy и recovery. |

Для `offline` допустима «Проверить связь» и последующее перечитывание
операции. Для `revoked` недопустимы auto-retry и продолжение передачи/печати:
только owner запускает новый enroll. Для `expired` старый код не повторяется;
нужен новый одноразовый код. Детальные формулировки, a11y и defect-owner для
`idle/loading/success/error/offline/expired/revoked/retry` — в карте мастера;
эта ссылка обязательна для Front и Bridge fixture/review.

## 9. Handoff и приёмка Front

Front расширяет текущие `apps/web/src/park/printerlivescreen.tsx`,
`livecommands.ts` и `livesource.ts`; отдельный локальный enum, основанный на
HTTP-кодах, не создаётся. Рекомендуемый чистый mapping —
`apps/web/src/park/remotecontrolstate.ts`, с fixtures из versioned API
contract. Текущая надпись MF-953 «Доедет на принтер, когда откроется…»
заменяется только тогда, когда API действительно даёт `sent`/ACK/error.

- [ ] Есть все состояния связи `online/offline/stale/reconnecting/revoked/error`
  с текстом, временем и recovery.
- [ ] Для pause/resume/cancel есть `queued/sent/ack/error/timeout/cancelled`,
  command card восстанавливается по `command_id`, а опасное действие требует
  explicit confirmation.
- [ ] Выбор, server validation, progress, потеря сети, resume, `file_complete`,
  `file_error` и отдельный запуск покрыты для G-code; 100 МБ не является
  пределом, который UI выдумал.
- [ ] Матрица owner/operator/viewer/guest, `403`, capability и revoke дают
  точный текст без раскрытия чужого устройства и секретов.
- [ ] A11y: keyboard/focus, 48 px, live-region, контраст и reduced motion
  проверены в реализации; visual regression снят на 390/820/1440 px.
- [ ] Перед release сверены API schema/fixture и runtime evidence MF-844/MF-845;
  при расхождении Front фиксирует blocker с полем и владельцем, не делает
  optimistic fallback.
