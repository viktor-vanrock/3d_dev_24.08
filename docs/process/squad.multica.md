# Сквады Multica: полномочия и взаимодействие

Актуально с 2026-07-13. Это организационный контракт v1. Полные исполняемые промпты находятся в Multica; их роли, границы и триггеры описаны в [agent.organization.md](agent.organization.md).

## Лестница решений

```text
оператор
├── внешний дизайн-агент (Claude Code / Codex CLI, вне Multica) — визуальное
│   лидерство и live-полиш напрямую на dev.3mf.tech, см. § «Design Studio»
└── CTO / Headquarters
    ├── Platform Guardian — философия и границы версий
    ├── Contract Architect — межсервисные контракты
    ├── Design — Design Studio
    ├── Lead — Autofab
    ├── Fleet — Devices
    ├── Growth — рынок и Community
    ├── Forecast — сроки и ресурсы
    └── Board Curator / Project / AgentOps — целостность системы
```

Внешний дизайн-агент — не Multica-агент: без промпта/runtime здесь, не ищи его в
`multica agent list`. Это оператор, работающий напрямую в чате с Claude Code или
Codex CLI. Подробности канала и как в него встраивается Design Studio — ниже.

CTO принимает направление, приоритет, срок и арбитраж. Он создаёт эпик и direction-карточки профильным лидам, но не ставит задачи разработчикам. Лид разворачивает направление первой волной 4–8 содержательных delivery-карточек; агенты могут создавать необходимые подзадачи и передавать их специалистам. Поэтому один эпик вправе вырасти до 100+ задач, но не до 100 независимых идей.

Одна delivery-карточка объединяет 3–7 связанных шагов, если у них один владелец,
контракт/экран и проверяемый итог. Код, тесты, документация и live-evidence не
разносятся по разным карточкам. Дробление оправдано другим владельцем, stage или
зависимостью, отдельным deploy/evidence либо настоящим блокером. Следующая волна
создаётся по факту нового разрыва, а не ради поддержания числа карточек.

## Сквады

### Headquarters

Совет, а не команда разработки. Platform Guardian проверяет соответствие [platform.md](../product/platform.md) и границам v1–v3; Contract Architect фиксирует швы; Design, Lead, Fleet и Growth отвечают за свои направления; Forecast даёт P50/P80 и critical path. Board Curator отличает Done от Cancelled и проверяет evidence, Project — дерево и project=v1, AgentOps — промпты, модели и автопилоты.

### Autofab

Исполнение под Lead: код, тесты и доставка. Разработчик заканчивает не комментом, а передачей следующему владельцу или проверенным commit. Удалённые ветки только `dev` и `main`: публикация `git fetch origin dev && git rebase origin/dev && git push origin HEAD:dev`. `main` меняет только Release после явного разрешения оператора.

Site Keeper непрерывно проверяет `origin/dev → deploy-dev → deployment marker → dev.3mf.tech`. Dev Delivery принимает конкретную карточку. Git хранит целостность репозитория; Ops — инфраструктуру; Release — prod-контур.

### Design Studio

Полная дизайн-команда под Design:

```text
UX journey → Layout shell/grid → Components reusable API
          → Page Composer spec → Front implementation
          → Accessibility → Visual QA on dev
```

Motion и Sound добавляют обратную связь, когда она объясняет состояние. Одноразовый экран запрещён при наличии повторяемого паттерна. Для принтеров Fleet сначала даёт технические факты и состояния, затем Design Studio превращает их в честный reusable UI. Канон — [design/readme.md](../design/readme.md), [components.md](../design/components.md), [printer.page-types.md](../design/printer.page-types.md).

**Внешний дизайн-агент (2026-07-18, решение оператора).** Оперативное творческое
лидерство — live-анализ на реальном dev.3mf.tech, точечные CSS/React правки,
калибровка веса/цвета/motion на глаз — ведёт оператор напрямую с внешним чат-агентом
(Claude Code или Codex CLI), который НЕ является Multica-агентом: без промпта, без
runtime, не виден в `multica agent list`, коммитит в `origin/dev` от имени оператора.
Это основной канал инициатив «улучшить дизайн в целом» — раньше такую волну
самостоятельно вела Design Studio, теперь створку экрана и вкусовое решение берёт
оператор+внешний агент; Design Studio подключается там, где нужна мощность сквада.

Итог такой работы попадает в Multica двумя путями: (1) внешний агент сам реализует
и пушит в `origin/dev` — Design Studio узнаёт об этом постфактум через Visual QA на
живом dev, роль независимой приёмки не меняется; (2) внешний агент находит/
специфицирует работу, но не реализует сам — заводит карточку в проекте
«Дизайн-система» с готовым кодовым ресёрчем (конкретные файлы/токены/компоненты) и
адресует Front/Layout/Components напрямую для локального фронта, либо Design для
декомпозиции при крупном эпике; мелкий однофайловый фикс — лейбл `quickfix` → сквад
QuickFix, не Design Studio. Творческое решение таких карточек не пересматривается —
Design Studio доводит его до реализации.

Прежние функции Design Studio без изменений там, где инициатива не идёт от оператора
напрямую: device-факты Fleet → reusable UI-состояние, CTO-направления,
кросс-сквадовые заявки, community-сигналы, независимая Visual QA/Accessibility-
приёмка live dev.

### Devices

Fleet руководит связью с физическими принтерами. Relay владеет data-plane, Bridge — connectors/device-agent, Gateway — public API, Verifier — identity/trust evidence, Telemetry Steward — события и SLO. Swarm обеспечивает совместимость архитектуры с будущим P2P, но не реализует P2P-обмен в v1 без нового решения CTO. Проверка на реальной локальной сети передаётся Polygon.

### Ресёрчеры

Брендовые исследователи собирают факты с provenance; Catalog QA независимо проверяет schema, единицы, aliases, дату и конфликт источников. Команда не пишет продуктовый код. Массовое наполнение начинается только при готовом ingest contract.

Для новостной ленты с 2026-07-22 массовый поиск выполняет изолированный локальный
OpenCode-контур на GPU: небольшая модель собирает источники и claims, большая
думающая модель оформляет материал. Grok не обходит бренды по расписанию, а
независимо модерирует готовый source-backed artifact и возвращает
`accept/revise/reject` плюс advisory `api_feedback`. Исполнение этой схемы ведёт
news-pipeline агент; досочный агент Community `Moderator` не является её
разработчиком и не должен получать инженерную карточку только из-за совпадения
слова «модератор». Полный контракт —
[feed.news.pipeline.md](../architecture/feed.news.pipeline.md).

### Community

Feedback Listener объединяет доказанную обратную связь, Topic Keeper поддерживает структуру знаний, Moderator отвечает за безопасные и обратимые действия. Команда не назначает roadmap: Growth/UX оценивают сигнал, CTO принимает направление. Агентное авторство прозрачно по [agents.and.humans.md](../product/agents.and.humans.md).

### Поддержка принтеров и локальная разработка

Creality/FLSun отвечают за особенности конкретных моделей, конфиги и firmware quirks, но не дублируют Devices. Polygon работает на Mac в сети реальных принтеров: обнаружение, прямой connector и evidence; изменение прошивки — только по явному разрешению оператора.

## Межсквадовый протокол

1. CTO фиксирует идею как эпик: документы-основания, метрика, acceptance, P50/P80, ресурс и приоритет.
2. Platform Guardian и Contract Architect дают решение о границе продукта и контрактах.
3. Профильные лиды создают связанные workstream: например Fleet fact + Design pattern + Lead implementation.
4. Исполнители реализуют самостоятельные delivery-блоки в общем `dev`, тестируют и передают Dev Delivery.
5. Site Keeper подтверждает, что SHA развернулся; Visual QA/QA проверяют живой результат.
6. Board Curator разрешает Done только при evidence. Forecast пересчитывает срок, CTO выбирает следующий разрыв.

Назначение карточки будит агента; mention и комментарий — только контекст. Любой handoff сохраняет `project=v1`, parent, priority, due date, dependency/stage, acceptance и docs lineage. Спор о цели идёт вверх к CTO, о техническом шве — к Contract Architect, о коде — к Lead, об опыте — к Design, о девайс-факте — к Fleet.

## Матрица ответственности

| Объект решения | Владелец | Обязательная консультация | Принимающий результат |
|---|---|---|---|
| Цель, версия и приоритет | CTO | Platform Guardian, Forecast, профильный лид | Board Curator |
| Межсервисный contract/schema | Contract Architect | Data, Lead, Fleet по device-зонам | Autofab/Devices |
| Реализация и интеграция кода | Lead | владелец contract/spec | Dev Delivery |
| Experience и reusable UI | Design | UX, Fleet/Back для фактов | Accessibility, Visual QA |
| Device protocol/state | Fleet | Bridge, Relay, Verifier, Telemetry Steward | Polygon + Autofab |
| Model-specific config/quirk | Creality/FLSun | Ресёрчеры, Fleet | Polygon/Bridge |
| Каталожный факт | брендовый исследователь | — | Catalog QA |
| Пользовательский сигнал | Feedback Listener | Topic Keeper, Moderator | Growth/UX, затем CTO |
| Dev availability | Site Keeper | Ops, Git, Dev Delivery | Lead |
| Production promotion | Release | Lead, QA, оператор | оператор |

Оперативное творческое направление по инициативе оператора ведёт внешний
дизайн-агент (см. § «Design Studio» выше); Design принимает готовые карточки этого
канала без пересмотра решения — консультация Fleet/Back для device-фактов остаётся
там, где инициатива не из этого канала.

Двойное членство — liaison, а не две вертикали власти. Front/Motion/Sound получают experience-acceptance от Design, но кодовый приоритет и интеграцию от Lead. Fleet входит в Headquarters как профильный лидер, но в Autofab представляет device-workstream, не управляет остальной разработкой. Telemetry Steward определяет device semantics с Fleet и реализует серверную часть под Lead.

## Автопилоты

Автопилоты полностью событийные; точная матрица —
[autopilots.event-driven.md](autopilots.event-driven.md). Доска будит лидов по
batch/transition, Git и deploy — по SHA/marker/failure, сайт — по health
transition, quota — по recovery. Успешный одиночный commit сам по себе не
будит совет: QA coalesce каждые 5 поставок, Visual QA — каждые 3 web, Release
— каждые 10. Старые PR/feature/main autopilots остановлены и лишены triggers.
