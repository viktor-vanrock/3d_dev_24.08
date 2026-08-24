# Issues

Трекинг задач — здесь, а не в GitVerse Issues: у публичного API GitVerse нет эндпоинтов для задач вообще (проверено по [офиц. документации](https://gitverse.ru/docs/collaborative/tasks), см. `docs/infra/readme.md` § «GitVerse Public API»), только веб-UI. Git-нативный трекинг — версионируется, ревьюится в PR, доступен мне без ручной синхронизации. Решение — 2026-07-03, «пока что» (может поменяться, если GitVerse откроет API или команда вырастет настолько, что понадобится богатый трекер с уведомлениями).

Правила оформления — `CONTRIBUTING.md` § «Задания».

## Доска

| # | Задача | Тип | Статус |
|---|---|---|---|
| [001](001.3mf.storage.md) | 3MF как единственный формат хранения | epic | open |
| [002](002.auth.triple.md) | Авторизация — Email-корп / PlagID / GigaID | epic | in-progress |
| [003](003.neural.search.md) | Нейропоиск по моделям и описаниям | epic | open |
| [004](004.branch.protection.md) | Защита ветки `main` | infra | open |
| [005](005.wiki.init.md) | Инициализировать Wiki | infra | open |
| [006](006.runner.register.md) | Зарегистрировать self-hosted раннер | infra | open |
| [007](007.database.design.md) | Дизайн БД — что/как/где храним | design | in-progress |
| [008](008.vds.runtime.md) | Поднять рантайм на VDS + секреты авторизации | infra | done |
| [009](009.dns.cloudru.md) | NS-перенос на cloud.ru (не понадобился) | infra | done |
| [010](010.avatar.mascot.md) | Персонаж-аватар «мейкер-маскот» | epic | in-progress |

**002 Фазы 1+2 (PlagID + email) — live на `https://3mf.tech`/`https://api.3mf.tech` по HTTPS**, e2e проверено, экран входа доведён по стилю (`design/` — разбор референса + тач-оптимизация). Осталось в 002: живой Telegram-вход глазами в браузере, email-провайдер для реальной отправки писем, Фаза 3 (id.ru) отложена. 007 — модель `users`/`user_identities`+`email_otp` реализована и работает в проде, остальные сущности БД (модели/заказы/принтеры) — открыты.

Статусы: `open` → `in-progress` → `done`, либо `blocked` (с причиной в файле). Обновляется вручную при работе над задачей — здесь нет автоматизации типа GitHub Projects, это осознанный компромисс за простоту.
