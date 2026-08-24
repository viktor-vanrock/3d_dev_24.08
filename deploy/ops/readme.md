# deploy/ops — операционные скрипты VDS (Autofab / Multica)

Версионированный **снимок** ops-скриптов, установленных на прод-VDS в `/usr/local/bin/` и
`/etc/systemd/system/`. Источник истины — сама машина; этот каталог держим в git для
дурабильности (бэкапы `portal.backup` пока локальные — если VDS умрёт, скрипты восстановить
отсюда) и ревью изменений. Полная механика — `docs/process/multica.internals.md` §10–11.

> ⚠️ Если правишь скрипт **на VDS** — синхронизируй сюда (и наоборот). Расхождение = грабля.

## Демон и обёртка (multica.internals.md §2, §10)

| Файл | Куда | Что |
|---|---|---|
| sandbox-db | /usr/local/bin/ | Безопасные throwaway-БД: обнаруживает dev Postgres, валидирует имена, копирует portal_dev только через pg_dump и чистит недосозданную БД. |
| `multica-wrapper-v3.sh` | `/usr/local/bin/multica` (реальный бинарь → `multica.real`) | Даёт агентам право `assign`/`update --assignee`: снимает ВСЕ `MULTICA_*` (иначе бинарь 0.3.40 детектит agent-контекст) + подставляет операторский токен. **Переустановить после апдейта multica.** |
| multica-daemon.service | /etc/systemd/system/ | Общий демон Claude/Codex: cap=2, MemoryHigh=22G/MemoryMax=26G, Restart=always. Очистка workspaces сюда намеренно не встроена. |

Установка обёртки: `sudo cp multica.real …; sudo install -m755 multica-wrapper-v3.sh /usr/local/bin/multica`.
Установка демона: `sudo cp multica-daemon.service /etc/systemd/system/; sudo systemctl enable --now multica-daemon`.

## Admission и восстановление очереди

multica-event-router.py держит в agent_task_queue не больше восьми ожидающих
запусков. Это исполняемый буфер, а не источник истины: избыток отменяется через
multica issue cancel-task, а намерение карточки сначала сохраняется в
multica_recovery_queue. Когда один из двух слотов освобождается, router
материализует следующий запуск через multica issue rerun.

Причины queued_expired и runtime_recovery также попадают в эту очередь.
Delivery gate имеет приоритет перед фоновым восстановлением, чтобы цикл
MF-карточка → коммит → origin/dev → health → dev.3mf.tech не зависал за
длинным хвостом старых работ. Router реагирует на PostgreSQL NOTIFY и сверяет
состояние раз в минуту только как защиту от потерянного события; это не
временной автопилот. Webhook-события остаются в outbox, пока заняты два
исполнительных слота; поэтому governance-runs не конкурируют с уже принятой
разработкой и не раздувают vendor-очередь.

Установка схемы и router описана в systemd units этого каталога.

## Автоматика «сигнал→карточка» (multica.internals.md §11)

| Скрипт (+`.service`/`.timer`) | Период | Триггер → действие |
|---|---|---|
| `prod-error-watch.py` | /5 мин | journald api/giga/mesh → `level:50`/5xx/Traceback → баг-карточка зоне (дедуп TTL 24ч, cap 3) |
| `synthetic-watch.py` | /10 мин | curl 6 ключевых URL → не-тот-код/таймаут → urgent-карточка |
| `portal-digest.py` | 08:00 МСК | дайджест в Telegram (доска+дельты, фичи/сутки, здоровье) |
| `portal-watchdog` | /3 мин | память/демон/прод/контейнеры/диск → авто-хил (restart) + инцидент-карточка Ops + Telegram |

## Очистка рабочих сред Multica

`multica-workspace-gc` — страховка для случая, когда встроенный GC демона не
удаляет старые каталоги. Он сверяется с `agent_task_queue` и удаляет только
`completed/failed/cancelled` workspaces старше 48 часов; у terminal-задач старше
24 часов отдельно чистит `node_modules/.next/.turbo/coverage`. Активные,
ожидающие и неизвестные каталоги не удаляются. Режим по умолчанию — dry-run,
systemd-service явно задаёт `APPLY=1`.

Установка: `sudo install -m755 multica-workspace-gc /usr/local/sbin/; sudo install
-m644 multica-workspace-gc.{service,timer} /etc/systemd/system/; sudo systemctl
daemon-reload; sudo systemctl enable --now multica-workspace-gc.timer`.
Шестичасовой timer допустим как инфраструктурный housekeeping: он не запускает
LLM-агентов и не заменяет событийные автопилоты.
Установка каждого: `sudo install -m755 <script> /usr/local/bin/; sudo cp <script>.{service,timer} /etc/systemd/system/; sudo systemctl enable --now <script>.timer`.
Юниты несут `Environment=HOME=/home/plag PATH=/usr/local/bin:/usr/bin:/bin` (иначе не найдут `multica`/`release-announce`); watch-скрипты — `Environment=APPLY=1` (реально заводить карточки).

## Не в этом каталоге (но ops-контур)
- `release-announce`, `mention`, `ask-operator*`, `webcheck`, `gitverse-pr-*` — хелперы в `/usr/local/bin/` (multica.internals.md §8).
- `~/gitverse-watch/` — вотчер PR/CI + вебхуки автопилотов; `~/tg-bridge/` — телеграм-мост.
- `multica-event-router.py` + `multica.event.sql` — актуальная событийная
  шина доска/Git/deploy/site/quota → Multica webhook. Старый
  `~/gitverse-watch/` более не является источником активных PR-flow triggers;
  см. `docs/process/autopilots.event-driven.md`.
- `scripts/changelog.mjs`, `scripts/version.mjs` — релизы (в корне репо, `versioning.md`).
