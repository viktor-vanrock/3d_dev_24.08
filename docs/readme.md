# Документация portal.ru — индекс

Вся документация проекта живёт здесь, в `docs/`, тематическими папками. Док = источник истины: протухший док — баг, чинится как баг. В корне репозитория остаются только файлы, которые инструменты ищут по точному пути (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE.md`, `CODE_OF_CONDUCT.md`, `readme.md`, `changelog.md`).

## Карта

| Папка | Что внутри | Владелец (сквад) |
|---|---|---|
| [architecture/](architecture/readme.md) | Архитектура: монорепо, границы сервисов, данные, окружения + [printer.server.md](architecture/printer.server.md) (серверный слой управления принтерами) + [data.fragmentation.md](architecture/data.fragmentation.md) (слайс-дедуп/P2P-обмен/платформа-верификатор) | CTO |
| [infra/](infra/readme.md) | VDS, деплой, облако, DNS, раннеры + [email.md](infra/email.md) (SMTP/доставляемость) | Ops |
| [design/](design/readme.md) | Дизайн-система и UX: стиль, палитра, компоненты, моушен, экраны | Design |
| [product/](product/platform.md) | [v1.command.md](product/v1.command.md) (операционный канон поставки), [v1.device.cloud.boundaries.md](product/v1.device.cloud.boundaries.md) (матрица allowed/forbidden v1/v2/v3 девайс-контура и слайсинга с владельцем и gate на пункт), **[platform.md](product/platform.md) (🧭 ДИРЕКТИВА-ФУНДАМЕНТ: мы Платформа, не Продукт — API-first, маховик данных, фрагментация, Верификатор; тест каждой фичи)**, [trust.md](product/trust.md) (доверие: торрент-модель, репутация слайсов/юзеров/устройств, ratio), [catalog-materials-ux.md](product/catalog-materials-ux.md) (UX-контракт каталога материалов, MF-11/MF-1465), [materials.catalog.journey.md](product/materials.catalog.journey.md) (путь и URL каталога материалов, MF-1474), [accounts.md](product/accounts.md) (юзеры/компании-фермы/бренды/дистрибьютеры, мультиаккаунт), [activation.md](product/activation.md) (first-run/онбординг: стейт-машина first_run→returning, персоны, тиры, чек-лист, MF-436), [vision.md](product/vision.md) (кто мы + канон V1), [roadmap.md](product/roadmap.md) (эпохи V1→V3 + версии/сроки), [philosophy.md](product/philosophy.md) (границы: Apple TV не терминал, touch+ТВ), [projects.md](product/projects.md) (публичный project landing + личная build session, завершение и API-границы), [agents.and.humans.md](product/agents.and.humans.md) (агенты+люди), [feedback.md](product/feedback.md) (сбор фидбека), [ux.md](product/ux.md) (сквозные принципы взаимодействия: точки входа, петли отклика, IA — ведёт UX), [features.md](product/features.md), [market.md](product/market.md), [brand.md](product/brand.md), [metrics.marketplace.md](product/metrics.marketplace.md) (liquidity/match-rate/take-rate/GMV/supply-demand маркетплейса, MF-731), [metrics.product.community.md](product/metrics.product.community.md) (AARRR + комьюнити Visitors/Contributions, MF-732; + воронка главной после чистки, MF-802) | CTO/оператор + UX |
| [process/](process/versioning.md) | Процессы: [versioning.md](process/versioning.md) (версии/релизы), [multica.md](process/multica.md) (доска), [multica.internals.md](process/multica.internals.md) (механика), [agent.organization.md](process/agent.organization.md) (организация), [autopilots.event-driven.md](process/autopilots.event-driven.md) (доска/Git/site/quota → webhook без cron-агентов), [agent.avatars.md](process/agent.avatars.md) (аватары), [tasks.multica.md](process/tasks.multica.md) (карточки), [squad.multica.md](process/squad.multica.md) (сквады и handoff), [headquarters.documentation.md](process/headquarters.documentation.md) (lineage), [api-keys.raci.md](process/api-keys.raci.md) (RACI центра доверия API-ключей), [telegram.md](process/telegram.md) (оператор), [gitverse.watch.md](process/gitverse.watch.md) (исторический Git-watcher), [testing.md](process/testing.md) (live-проверка), [skills.md](process/skills.md) (скиллы), [git.hygiene.md](process/git.hygiene.md) (ветки), [ideas.agents.md](process/ideas.agents.md) (агенты сверяются с топом идей перед фичей), [hyperpc.local.llm.md](process/hyperpc.local.llm.md) (локальные LLM для поисковых агентов: 4 GPU-слота HYPERPC, изолированный OpenCode-раннтайм `ocsearch`) | Lead/Docs |
| [epics/](epics/readme.md) | Спеки больших инициатив (ресёрч, варианты, фазы, критерии приёмки) — вкл. [printer.support.md](epics/printer.support.md) (уровни list/managed/custom + прошивка) и [printer.operating.surface.md](epics/printer.operating.surface.md) (MF-1193: честные состояния и reusable operating UI) | CTO |
| [research/](research/readme.md) | Ресёрч-данные и схемы: БД принтеров ([printer.schema.json](research/printer.schema.json)), рынок/протоколы ([printer.protocols.md](research/printer.protocols.md)) | Ресёрчеры/Back |
| [issues/](issues/readme.md) | Трек-файлы заданий (сквозные номера, статусы) | Lead |
| [contracts/](contracts/readme.md) | Версионированные решения по межкомандным API/данным и fixtures | Contract Architect |
| [qa/printer-safe-command-matrix.md](qa/printer-safe-command-matrix.md) | QA-матрица safe test job: allowlist команд, коды отказа, replay и redacted evidence | QA |
| [runbooks/printer.live.safety.md](runbooks/printer.live.safety.md) | Каркас (MF-1540) операционного runbook safe test job: preconditions, роль владельца, exact-variant, stop conditions, rollback, redaction; stage 1, без live-команд | QA/Docs |
| [api.public.md](api.public.md) | Публичный API управления принтером v0 (MF-888): auth/scopes/rate-limit, эндпоинты `/v0/printers*`, «сделай сам» без нашей прошивки | Devices/Gateway |
| [audits/user.printer.inventory.mf1348.md](audits/user.printer.inventory.mf1348.md) | Read-only инвентаризация связи `user↔printer`, фактических полей, ограничений и агрегатов (MF-1348) | Docs/Data |

Канон project-as-code: [продуктовая модель](product/project.as.code.md),
[технический манифест](architecture/project.manifest.md) и
[эпик MF-1963](epics/project.as.code.md).

## Куда класть новое

### Структура доков

- **Новый док по существующей теме** — в её папку, ссылка из `readme.md` папки (у design/ и infra/ главный файл — `readme.md`).
- **Новая тема без папки** — сначала одиночный файл прямо в `docs/`; папку заводим, когда файлов по теме становится ≥2.
- **Нейминг** — lowercase, слова через точку, без `-`/`_` (правила и исключения — `CONTRIBUTING.md` § «Нейминг»).
- Пути в текстах и комментариях кода пишем от корня репо: `docs/design/components.md`.

### Правило: перед фичей читаешь док и ведёшь свой

**Главный закон репо:** протухший док = баг, чинится как баг. Чтобы держать его свежим, действует правило:

**Перед началом работы** — прочитай профильные доки:
- Правка `apps/web` → читай `docs/design/readme.md` (дизайн-система, паттерны) и соответствующие тематические файлы (компоненты, лейауты, экраны).
- Правка `apps/api` → читай `docs/architecture/readme.md` и `docs/epics/backend.foundation.md` (если есть).
- Работа с инфрой → читай `docs/infra/readme.md`.
- **Любая продуктовая фича → СНАЧАЛА `docs/product/platform.md`** (🧭 философия: мы Платформа, не Продукт). Тест перед постановкой: фича усиливает маховик (API / данные / сеть / сообщество) или это разовая вертикаль, которую сделал бы кто-то поверх нашего API? Второе — даём API, не пилим сами. Затем `docs/product/vision.md`, `docs/product/roadmap.md` (где фича упомянута).
- Принтеры / девайс-контур / управление парком → читай `docs/epics/printer.support.md` (уровни поддержки + прошивка), `docs/architecture/printer.server.md` (серверный слой, коннекторы Moonraker/Bambu/Prusa), `docs/research/printer.protocols.md` (рынок, протоколы, матрица моделей).

**По ходу работы** — ведёшь свой `.md` (новый или обновляешь существующий):
- Заводишь новый компонент, паттерн или принцип? Новый файл в профильную папку (или раздел в existing) с ссылкой из `readme.md`.
- Меняется архитектура, процесс или продуктовая стратегия? Обновляешь соответствующий док или спеку эпика.
- Результат: на момент готовности фичи (merge в dev) её док уже синхронизирован с кодом — никаких «потом обновим**.

Исключение: мелкие правки кода (рефакторинг, багфикс) без смены контракта/поведения — док обновлять не нужно. Сомневаешься — пингуй владельца дока (см. карту выше).
