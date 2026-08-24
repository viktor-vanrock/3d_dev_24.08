# portal.ru (3mf.tech)

Портал для тех, кто печатает и создаёт своими руками. Домены: **3mf.tech**, **api.3mf.tech**.

Аналог MakerWorld / Printables, но:
1. **Заточен под совместимость** — принтеры и филаменты разных производителей, а не одна экосистема.
2. **Российский рынок** — рублёвые выплаты авторам, RU-поставщики филамента/железа, локальное комьюнити (западные платформы отрезали RU-авторов от выплат).
3. **Не только печать** — единая точка DIY России: 3D-печать, ЧПУ, лазер, дерево, металл, самоделки в целом.

> ## 📋 Где ведётся работа — доска задач
> **Все задачи проекта — на доске `https://tasks.3mf.tech` (Multica), воркспейс `3mf`, префикс `MF`.** Не GitVerse Issues.
> Прежде чем что-то делать — открой доску, найди/заведи карточку, держи статус (`todo → in_progress → done`).
> - Агентам (в т.ч. ИИ): как оперировать доской — **[docs/process/multica.md](docs/process/multica.md)**; правила и оформление карточек — **[docs/process/tasks.multica.md](docs/process/tasks.multica.md)**; общая памятка входа — **[CLAUDE.md](CLAUDE.md)**.
> - **Договорённость: любое поручение = карточка на доске со статусом, а не «тихое» действие.**

**Вся документация — [docs/](docs/readme.md)** (тематические папки: architecture / infra / design / product / process / epics / issues; там же индекс и карта владения). Ниже — прямые ссылки на главное.

## Продукт

- [docs/product/vision.md](docs/product/vision.md) — позиционирование, миссия, кого обслуживаем
- [docs/product/market.md](docs/product/market.md) — конкуренты и российский рынок
- [docs/product/features.md](docs/product/features.md) — ключевые фичи, MVP, roadmap
- [docs/product/brand.md](docs/product/brand.md) — имя, домен, дизайн-код
- [docs/design/readme.md](docs/design/readme.md) — разбор визуального стиля (тёмная тема, тач/киоск-паттерны), дальше — мелкие тематические файлы в `docs/design/`
- [docs/infra/readme.md](docs/infra/readme.md) — инфраструктура (VDS/деплой/облако), без секретов
- [docs/infra/email.md](docs/infra/email.md) — общая SMTP-инфраструктура (Timeweb, `auth@3mf.tech`) для всех сервисов проекта — как переиспользовать, доставляемость, диагностика

## Разработка

- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS_.md) — памятка входа для ИИ-агентов (доска задач + правила); читается ИИ автоматически
- [docs/architecture/readme.md](docs/architecture/readme.md) — монорепо, сервисы, как всё связано
- [CONTRIBUTING.md](CONTRIBUTING.md) — ветвление, коммиты, PR-процесс, нейминг
- [docs/process/versioning.md](docs/process/versioning.md) — схема версий `YY.RELEASE.MINOR`, релизный процесс
- [SECURITY.md](SECURITY.md) — политика безопасности, секреты, зависимости
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — нормы поведения в команде
- [LICENSE.md](LICENSE.md) — проприетарная лицензия
- [changelog.md](changelog.md) — журнал релизов
- [docs/issues/](docs/issues/readme.md) — текущие задачи (git, не GitVerse Issues — см. `CONTRIBUTING.md` § «Задания»)
- [docs/epics/](docs/epics/readme.md) — спеки больших задач (индекс)
- [docs/process/tasks.multica.md](docs/process/tasks.multica.md) — живая доска задач `tasks.3mf.tech` (Multica): как пользоваться, добавлять юзеров, подключать агентов
- [docs/process/multica.md](docs/process/multica.md) — гайд для агентов: как оперировать доской в режиме API/CLI и в режиме демона (исполнение)
- [docs/process/squad.multica.md](docs/process/squad.multica.md) — сквад агентов Autofab (CTO → Lead → {Design, Fullstack, Data, PM} → разрабы + пайплайн): иерархия, роли, правила ведения доски
- Wiki репозитория — онбординг/справочники (см. `CONTRIBUTING.md` → «Где что искать»)

## Быстрый старт

```bash
pnpm install
pnpm dev              # поднимает apps/web + apps/api параллельно (turbo)
```

Python-сервисы (`apps/mesh`, `apps/giga`) — см. `docs/architecture/readme.md` § «Локальный запуск».

## ⚠️ Осталось руками

3 задачи требуют веб-UI gitverse.ru (недоступно через публичный API) — `docs/issues/004.branch.protection.md` (защита `main`), `docs/issues/005.wiki.init.md` (инициализация Wiki), `docs/issues/006.runner.register.md` (self-hosted раннер). Рантайм и TLS на VDS уже подняты (`docs/issues/008`/`009` закрыты). Актуальный статус — `docs/issues/readme.md`.

## Происхождение

Черновой ресёрч рынка проведён в проекте `3dmake` (`draft.plag.space/3dmake`, локально `~/Development/draft.plag.space/projects/3dmake/`) — многоагентные Workflow по мировым маркетплейсам, персонам, RU-рынку, брендингу. Продуктовые `.md` в корне — выжимка ключевого, без сырых данных ресёрча.

**Секреты (ключи S3, токены, `.env`) не хранятся в этом репозитории** — только локально на VDS. См. `SECURITY.md`.
