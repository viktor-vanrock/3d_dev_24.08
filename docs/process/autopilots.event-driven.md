# Событийные автопилоты Multica

С 2026-07-13 агенты не просыпаются по расписанию. В Multica нет активных
`schedule`-триггеров: каждый запуск объясняется изменением доски, завершением
задачи, Git/deploy/site transition, CI failure или quota recovery.

## Принцип

Sensor может дёшево наблюдать состояние, но не расходует агентный запуск.
Событийный router будит агента только при переходе, а не при каждом измерении:

```text
board DB trigger ─┐
task terminal ────┼→ durable outbox → threshold/dedupe → Multica webhook
deploy/site ──────┤
quota transition ─┘
```

Каждый event имеет факт, порог, fingerprint и узкий payload. Router хранит
outbox и fire-log в Postgres, поэтому рестарт не теряет событие и повторная
доставка одного fingerprint не создаёт второй запуск.

## Матрица событий

| Сигнал | Порог | Получатель | Зачем |
|---|---:|---|---|
| новая v1-карточка | каждый номер, кратный 10 | Project, Board Curator | структура batch и capacity |
| структурный дефект карточки | 5 уникальных | Project | project/parent/owner/due/acceptance |
| переход в `in_progress/in_review` | 5 | Docs | lineage только нового batch |
| переход в `in_review` | 5 | Dev Delivery | commit→marker→dev evidence |
| переход в `done` | 10 | Docs, Forecast, Board Curator | docs drift, throughput, честный Done |
| переход в `blocked` | 5 | Forecast, CTO | системная зависимость, а не единичный шум |
| `todo` без assignee | сразу | Lead | назначить либо отменить дубль |
| изменённая просроченная карточка | 5 | Forecast | срок затронутого эпика |
| terminal runs без продвижения | каждый 3-й за 24 ч | Lead | разрезать/reassign/block |
| runtime failure | 3 | AgentOps | общий root cause |
| pending tasks пересекли 4 вниз | transition | CTO | очередь действительно иссякла |
| успешный web/api deployment | каждый 5-й | QA | coalesced smoke/regression; docs-only не считается |
| успешный web deployment | каждый 3-й | Visual QA | visual batch |
| printer web deployment | каждый 3-й | Design council | Fleet fact→reusable UI |
| web/api deployment | каждый 10-й | Release | readiness, без auto-main |
| deploy/site failure или recovery | transition | Site Keeper/Ops | устранение и evidence |
| Git anomaly | сразу | Git | лишняя ветка/non-FF |
| quota paused→available | transition | CTO, AgentOps | возобновить утверждённые потоки |
| CI failure | сразу из CI | Test | воспроизвести и починить |

Порог — не обещание создать карточку. Промпт каждого автопилота требует
обработать только `eventPayload` и допускает «ничего не создавать», если факт
не подтверждает действие.

## Реализация

- Router: `deploy/ops/multica-event-router.py`.
- SQL outbox/triggers: `deploy/ops/multica.event.sql`.
- Service: `multica-event-router.service`.
- `portal.deploy-dev.service` после запуска передаёт SHA/markers/HTTP/paths;
  `OnFailure` передаёт deploy failure.
- `quota-guard.service` передаёт только смену paused-state.
- Секретные webhook URL находятся только в
  `/home/plag/.config/multica-event-router.json` (`0600`), не в Git.
- Локальное состояние deploy/quota sensor — `/home/plag/.local/state/`.

Sensors `portal.deploy-dev.timer` и `quota-guard.timer` могут оставаться
таймерами: они не запускают LLM, а лишь обнаруживают переход. Запрещено
маскировать cron-агента sensor-ом, который на каждом тике отправляет webhook.

## Паузы и retired flow

Статус автопилота контролирует оператор. Перевод на webhook не включает
поставленный на паузу объект. Старые PR/feature/main и тестовые автопилоты
сохранены paused как история, но их triggers удалены. `main` остаётся только у
Release после явного решения оператора.

## Проверка и откат

```bash
multica autopilot list --output json
systemctl status multica-event-router
sudo journalctl -u multica-event-router -n 100
docker exec multica-postgres-1 psql -U multica -d multica -c \
  "select kind, processed_at from multica_event_outbox order by id desc limit 20"
```

Перед миграцией создан backup в
`/home/plag/multica-backups/*-event-driven-autopilots/`. Для аварийной
остановки достаточно остановить router; outbox сохранит новые факты. DB
triggers удаляются независимо от vendor schema.


## 2026-07-16 — только триггеры, никаких таймеров

Директива оператора: автопилоты живут СУГУБО на триггерах (вебхуки от
event-router и реальных событий). Проверено: все 27 автопилотов — webhook-only,
schedule-триггеров ноль. Искусственные таймеры, будившие агентов по расписанию,
отключены: autofab-rush.timer (dev, топ-ап ранов каждые ~20 мин),
dod-reconcile.timer (worker, был выключен ранее). Продуктовые data-конвейеры
(scout-*, giga-*) — не агентская оркестрация, живут на своих таймерах.

## Git-философия (напоминание, жёсткое)

Внешних веток не существует: ни локальных, ни на GitVerse. Один живой организм
на общей dev: fetch → rebase detached HEAD → push HEAD:refs/heads/dev; конфликт
решается на месте. Финал работы = живой результат на dev.3mf.tech /
api.dev.3mf.tech либо честный фундамент для других агентов. Автопилот
«Git: гигиена репо» при появлении посторонней ветки вливает её коммиты в dev и
УДАЛЯЕТ ветку немедленно; повторный нарушитель — эскалация CTO.
