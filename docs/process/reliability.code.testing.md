# Том решений: стабильная разработка и тестирование v1

**Статус:** действует с 2026-07-15  
**Владелец:** Headquarters / CTO  
**Область:** путь от идеи до проверяемого результата на `dev.3mf.tech`.

Связанные документы: [CONTRIBUTING.md](../../CONTRIBUTING.md),
[жизненный цикл карточки](board.lifecycle.md), [событийные автопилоты](autopilots.event-driven.md),
[тестовая лаборатория](testing.md), [CI/CD](../infra/cicd.md).

## 1. Канонический цикл

```text
идея → эпик/спека → карточка → реализация → origin/dev
     → автодеплой → проверка dev.3mf.tech → доказательство → done
```

Сессия агента, коммит и статус `completed` сами по себе не являются
результатом. Для закрытия нужны номер карточки, SHA в `origin/dev`,
затронутый контур, проверка и доказательство в карточке. Для чистой
документации допускается финал `docs-only`, это явно указывается.

## 2. Решения

| ID | Решение | Зачем |
|---|---|---|
| D-001 | В origin только `dev` и `main`; рабочий push — `HEAD:dev`. | Исключить потерянные agent/docs-ветки. |
| D-002 | `dev` — контракт доставки; сломал — fix-forward. | Общий живой результат всегда проверяем. |
| D-003 | Multica хранит намерение, Git и deploy — доказательства. | Коммит без карточки не считается поставкой. |
| D-004 | Vendor queue не хранит намерение. Outbox и `multica_recovery_queue` durable. | Рестарт, квота и queue expiry не теряют работу. |
| D-005 | LLM запускают только переходы состояний. Таймеры могут лишь обнаруживать переход. | Нет холостого fan-out. |
| D-006 | Admission проверяет active+queued до webhook. При cap payload остаётся в outbox. | Не создавать лавину `queued_expired`. |
| D-007 | Тестовая БД всегда изолирована через `sandbox-db`. | Не повреждать общую dev/production БД. |
| D-008 | `done` только после delivery/QA evidence. | Completed агента не маскирует ошибку. |
| D-009 | Delivery evidence имеет отдельный pending-state и не теряется из-за cap. | Реализация доходит до живого стенда. |
| D-010 | Quota/429 вызывает cooldown и событие перехода, а не слепой retry. | Не тратить лимит и не размножать задачи. |

## 3. Контрольный аудит VDS: 2026-07-15

- Демон active, фактический cap **2**; cgroup: MemoryHigh 22 GiB,
  MemoryMax 26 GiB, swap 8 GiB.
- Очередь: **2 running, 5 queued**; recovery: **43 waiting**.
- Durable outbox: **31 issue_changed и 3 issue_created** pending — это
  backpressure, а не потеря.
- `portal.deploy-dev.timer` active; последний проверенный web SHA:
  `1cb650e4`; сайт ответил HTTP 200.
- Диск: 99 GiB всего, 87 GiB занято, около 8 GiB свободно (92%). Слепой
  `docker prune` или удаление workspaces запрещены.
- За 24 часа: provider quota **297**, `queued_expired` **189**,
  runtime recovery **4**, model unavailable **1**. Главный bottleneck —
  квота/пропускная способность, не bwrap и не отсутствие места.
- По агентам нагрузка сосредоточена у Front/Back/Layout/Docs/Data. Это
  требует admission и приоритетных lanes, а не массового увеличения cap.
- Router unit-тесты: **10/10 зелёные**. Исторические HTTP 429 были замечены
  в journal; в router уже есть endpoint cooldown/backoff, но нужен e2e-тест
  реального outbox → cooldown → retry цикла.
- В документации найден drift: старые cap=3 и 4ГБ-лимиты против фактического
  cap=2 и текущего cgroup. Это отдельный docs fix, не основание менять живой
  лимит без метрик.

## 4. Политика очереди и восстановления

Состояния разделяются:

- карточка: `backlog → todo → in_progress → in_review → done`;
- vendor task: попытка исполнения;
- recovery: обещание повторить допустимую карточку;
- outbox: факт, ещё не доставленный агенту;
- `delivery_pending`: поставка ждёт проверки.

Правила:

1. При заполненном cap webhook не вызывается; факт остаётся durable.
2. Избыток queued-task отменяется и превращается в
   `admission_deferred` recovery.
3. При свободном слоте сначала проверяется delivery evidence, затем одна
   recovery-карточка по priority и возрасту.
4. `done` и `cancelled` не получают recovery.
5. Старая `queued_expired` не возвращает `in_review` в разработку без
   решения Dev Delivery/QA.
6. После quota recovery CTO выпускает ограниченную волну по критическому
   пути: web/design и printer connect.

## 5. Green Gate по типу изменения

| Контур | До push | После deploy | Evidence |
|---|---|---|---|
| docs-only | Markdown/link check | не требуется | SHA + список договоров |
| Web | lint, typecheck, unit, build | `webcheck`; для UI `vmatrix` и `a11y` | URL, HTTP, скрин/артефакт, SHA |
| API | lint, typecheck, unit/contract, build | auth-aware health и сценарий | код ответа, SHA |
| DB/migration | `sandbox-db`: create, up/down/idempotency | smoke API при изменении контракта | sandbox name, вывод, drop |
| device/relay | build/test/config | health/handshake, если железо доступно | версия и наблюдаемый факт |
| infra/deploy | syntax/unit/dry-run | service, health, marker, rollback-path | journal + health + SHA |
| performance | целевой `loadtest`/autocannon | только на dev | VU/duration/p95/p99 |

Fresh worktree обязан выполнить один `pnpm install --frozen-lockfile`.
`node_modules` между worktree не шарим. Отсутствие `vitest` до bootstrap
не является продуктовым падением; повторный прогон обязателен. Ошибка без
owner, факта и следующего шага не может быть отмечена как completed.

Шаблон карточки:

```text
Поставка: MF-XXXX
SHA origin/dev: <sha>
Контур: web | api | device | docs-only | infra
Проверки: <команда> — <результат>
Dev: <URL / health / marker>
Ограничение: <нет или точный факт>
```

## 6. Git и независимая доставка

```bash
git config user.name "<роль>"
git fetch origin dev
git rebase origin/dev
# Green Gate
git push origin HEAD:dev
```

После push ждём соответствующий SHA/marker на dev. Красный web не должен
блокировать API/docs навсегда: deploy хранит последний успешный SHA контура,
делает ограниченный backoff, публикует failure/recovery и проверяет health
после restart.

## 7. Ошибки

| Класс | Действие |
|---|---|
| quota/429/model capacity | cooldown, квотная карта CTO, ограниченная волна |
| queued_expired | recovery с dedupe, без массового rerun |
| worktree dependencies | frozen-lockfile bootstrap, повтор Gate |
| description.md | stdin или абсолютный разрешённый файл, ошибку не скрывать |
| DB/extension/schema | sandbox-db, не общая БД |
| rebase/non-FF | fetch/rebase свежего dev, узкий fix-forward |
| deploy/health | backoff, событие Ops, SHA и rollback |
| printer/network | blocked с owner и условием снятия |

## 8. События и метрики

Новые автопилоты сначала описываются в
[autopilots.event-driven.md](autopilots.event-driven.md), затем получают
router-код и тест. Запрещён LLM-агент, просыпающийся по расписанию.

CTO/AgentOps отслеживают: active/queued/recovery, возраст oldest outbox,
queued_expired за 24 часа, quota failures по model, done без SHA/evidence,
origin/dev без deploy marker, серии deploy failures, свободный диск и число
sandbox. При свободном месте менее 15 GiB — инвентаризация владельцев и TTL,
затем обратимая очистка.

## 9. План

### Сегодня

1. Закрыть reliability-эпик только с evidence для admission, recovery,
   deploy backoff и terminal cancellation.
2. Исправить документационный drift cap/cgroup/unit names.
3. Выпустить recovery только по критическому пути и свободному cap.
4. Проверить oldest outbox и живой cooldown router.
5. Составить список workspaces/sandbox по владельцу, TTL и размеру.

### За неделю

1. E2E-тест: outbox → admission → cooldown → recovery → terminal cancel.
2. Machine-readable delivery evidence: MF, SHA, contour, health, artifact.
3. CI-матрица по затронутым контурам и миграциям.
4. Baseline ключевых экранов printer connect, fleet, auth и design system.
5. Явный quota toggle с историей переходов.

### Перед ростом параллельности

1. Накопить 7 дней метрик queue expiry, quota, p95, deploy и disk growth.
2. Поднимать cap только когда recovery не растёт, dev зелёный, свободно
   минимум 15 GiB и провайдер выдерживает волну.
3. Разделить lanes: product delivery, quality, platform reliability.
4. Создавать follow-up только из классифицированной ошибки с fingerprint и
   dedupe.

## 10. Ответственность

Headquarters/CTO выбирает критический путь и бюджетирует квоту. Project
следит за эпиками и сроками. Leads режут направления на проверяемые карточки.
Исполнитель делает код, Gate и push. Test/QA воспроизводят риск. Dev Delivery
сверяет SHA → deploy → dev evidence. Ops/Site Keeper отвечает за router,
daemon и rollback. Git отвечает за линейность dev и отсутствие лишних веток.

Любая роль может остановить волну при нарушении D-002, D-006 или D-007, но
обязана оставить факт, owner и условие возобновления.

## 11. Как менять том

Новое постоянное правило добавляется как D-XXX с датой, причиной,
рассмотренной альтернативой и проверяемым следствием. Сначала обновляется
этот том и матрица событий, затем код/конфигурация, затем тест.
