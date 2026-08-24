# GitVerse watcher — историческая схема

Документ сохранён как указатель после миграции 2026-07-13. Старый
`~/gitverse-watch` и PR/feature/main flow больше не являются частью рабочей
системы: каталога и systemd timer на dev-машине нет, соответствующие
автопилоты поставлены на паузу и лишены triggers.

Актуальная схема — [autopilots.event-driven.md](autopilots.event-driven.md):

- board и task transitions пишет durable Postgres outbox;
- `portal.deploy-dev` передаёт origin/dev SHA, markers, changed paths и health;
- Git-аномалия означает только unexpected remote branch/non-FF/orphan evidence;
- CI failure идёт прямым webhook к Test;
- успешный commit не будит агента сам по себе: события coalesce по порогам;
- `main` не участвует в автоматическом flow и меняется только Release после
  явного решения оператора.

Webhook secrets находятся в
`/home/plag/.config/multica-event-router.json` с режимом `0600`. Исходники
router и SQL triggers — `deploy/ops/multica-event-router.py` и
`deploy/ops/multica.event.sql`.
