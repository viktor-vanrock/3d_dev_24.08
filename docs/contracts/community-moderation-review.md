# Проверка целостности community API и lineage moderation-контракта

Дата проверки: 2026-07-13  
Основания: `docs/epics/community.foundation.md` (MF-414), API Фазы 2 (MF-415), MF-1417, `docs/issues/007.database.design.md`, документы `docs/contracts/community-moderation*.md`.
Контур: docs/contracts и API → PostgreSQL; UI и визуальная доступность не проверялись.

## Чек-лист

- [x] Термины `communities` / `community_members` / `threads` / `posts` / `votes` сверены с миграцией и `db/schema.sql`.
- [x] Роуты community зарегистрированы в `apps/api/src/server.ts`.
- [x] Авторизация и UUID-проверки проверены на create/list/detail/join/leave/role/thread/post/vote/accept.
- [x] Семантика повторных мутаций сверена с ограничениями БД и ответами API.
- [x] Граница ранней миграции `moderation_actions` и полной поставки `flags`/`audit_events` сверена с acceptance и handoff MF-1435.
- [x] Найденные дефекты классифицированы и закрыты или переданы отдельными карточками.

## Findings

### MF-REV-01 — повторный join владельца возвращает неверную роль

Класс: контракт ответа / состояние членства; приоритет: medium; владелец: Back.

В `apps/api/src/community/membership.ts:27-32` `joinCommunity` выполнял `ON CONFLICT DO NOTHING`, но всегда возвращал `{ role: "member" }`. Поэтому владелец или модератор, повторно вызвавший `POST /communities/:id/join`, получал роль `member`, хотя строка `community_members` оставалась с ролью `owner`/`moderator`. Это противоречило `GET /communities/:id` (`viewer_role`) и заставляло клиент потерять права в локальном состоянии. Карточка фикса: MF-1433.

Исправлено в MF-1433 (commit `df69c76`): повторный join возвращает фактическую роль из `community_members`, а join участника остаётся идемпотентным.

### MF-REV-02 — accept неидемпотентен и повторно начисляет репутацию

Класс: целостность данных / повторяемость команды; приоритет: high; владелец: Back.

В `apps/api/src/community/accept.ts:43-47` каждый `POST /threads/:id/accept` с тем же `post_id` вызывал `awardAcceptedAnswer`, даже если `threads.accepted_post_id` уже равен этому значению. `reputation_events` не имел уникального ограничения для этого события, поэтому повтор запроса (ретрай клиента или повторный клик) начислял автору ответа дополнительные +15. Документированный контракт описывает accept как смену принятого ответа, а не как повторное начисление. Карточка фикса: MF-1434.

Исправлено в MF-1434 (commits `07483d4`, `b44ed94`): начисление `answer_accepted` проверяется в транзакции под блокировкой пользователя, исторические дубли безопасно схлопываются, а уникальный частичный индекс `reputation_events_answer_accept_once_idx` не допускает более одного события для пары `(user_id, subject_id)`. Повторный accept того же ответа и ретрай после смены ответа возвращают `200`, но не создают новый reward event.

### MF-REV-03 — lifecycle `moderation_action` расходится с ранней миграцией

Класс: контракт документации/схемы; приоритет: high; владелец: Data/Back.

В ранней миграции `apps/api/db/migrations/20260713010000_moderation_actions.sql` отсутствовали `moderation_actions.status`, reversal-инварианты и `audit_events`, хотя acceptance требовал переход `applied → reversed` и проверку аудита. Поэтому acceptance нельзя было выполнить на одной поставке MF-1417: состояние действия нельзя было отличить от отменённого, а проверка поля `status` завершалась бы ошибкой отсутствующего столбца.

Передано в MF-1437. Документы после handoff явно помечают раннюю миграцию неполной, связывают status/reversal, durable idempotency и `audit_events` с отдельной зависимостью MF-1435; до её поставки finding остаётся открытым и не считается закрытым одной документацией.

## Закрытые проверки

- FK и check-ограничения community-миграции согласованы с доменной моделью; `votes` и `taggings` используют заявленный полиморфный контракт.
- Роуты из API-контракта действительно подключены в `server.ts`; прежнее замечание из старой спеки `docs/design/community.md` о том, что роуты отсутствуют, устарело.
- Для moderation-контракта зафиксирована граница: ранняя миграция не объявляется полной поставкой, а обязательная Data-зависимость MF-1435 указана в acceptance и handoff.
- Признаков нарушения границы `web → api → DB` и утечки секретов в проверенном контуре не найдено.
