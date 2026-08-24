# Реестр решений по скиллам (Autofab)

Скиллы агентам ставит и снимает **только CTO** (скилл впрыскивается в контекст роли на каждой задаче — кривой тихо портит роль). Здесь — журнал решений: что поставлено, кому, зачем, вердикт. Заявки агентов приходят CTO тегом (процесс — скилл `propose-skill`).

## Текущие назначения (снимок 2026-07-10, сверен с `multica agent skills list`)

| Агент | Скиллы |
|---|---|
| CTO | autofab-devlab, brainstorming, dispatching-parallel-agents, find-skills, propose-skill, skill-creator, writing-plans |
| Lead | autofab-devlab, autofab-lighthouse, autofab-webtest, dispatching-parallel-agents, finishing-a-development-branch, propose-skill, subagent-driven-development, verification-before-completion, writing-plans |
| UX | autofab-visual, brainstorming, Design Systems Index, writing-plans |
| Design | accessibility-auditor, autofab-a11y, autofab-devlab, autofab-lighthouse, autofab-visual, autofab-webtest, Design Systems Index, frontend-design, propose-skill, Visual Qa, Web Accessibility (WCAG 2 AA), Web Animation Design, webapp-testing, web-design-guidelines |
| Fullstack | autofab-devlab, autofab-lighthouse, autofab-load, autofab-sandbox, autofab-webtest, E2E Testing Patterns, propose-skill, REST API Design, systematic-debugging, test-driven-development, vercel-react-best-practices, verification-before-completion |
| Data | autofab-analytics, autofab-data, autofab-devlab, autofab-sandbox, autofab-webtest, propose-skill, REST API Design, verification-before-completion, writing-plans |
| Back | autofab-data, autofab-devlab, autofab-load, autofab-sandbox, autofab-webtest, Performance Testing Toolkit, propose-skill, REST API Design, systematic-debugging, test-driven-development, verification-before-completion |
| Front | accessibility-auditor, autofab-a11y, autofab-devlab, autofab-lighthouse, autofab-visual, autofab-webtest, E2E Testing Patterns, propose-skill, vercel-composition-patterns, vercel-react-best-practices, vercel-react-view-transitions, Visual Qa, Web Accessibility (WCAG 2 AA), webapp-testing, Web Auto Analyzer |
| Mesh | autofab-devlab, autofab-load, autofab-sandbox, autofab-webtest, propose-skill, systematic-debugging, test-driven-development, verification-before-completion |
| AI | autofab-data, autofab-devlab, autofab-webtest, propose-skill, systematic-debugging, test-driven-development, verification-before-completion |
| Ops | autofab-devlab, autofab-load, autofab-webtest, Performance Testing Toolkit, propose-skill, systematic-debugging, verification-before-completion, Web Perf |
| QA | accessibility-auditor, autofab-a11y, autofab-devlab, autofab-lighthouse, autofab-load, autofab-visual, autofab-webtest, E2E Testing Patterns, Performance Testing Toolkit, propose-skill, Visual Qa, Web Accessibility (WCAG 2 AA), webapp-testing, Web Auto Analyzer |
| Growth | autofab-analytics, autofab-data, autofab-devlab, writing-plans |
| Motion | autofab-devlab, autofab-visual, autofab-webtest, propose-skill, vercel-react-view-transitions, Web Animation Design, webapp-testing |
| Sound | autofab-devlab, autofab-webtest, propose-skill, webapp-testing |
| Reviewer | autofab-a11y, autofab-devlab, autofab-lighthouse, autofab-visual |
| Test | autofab-devlab, autofab-load, autofab-visual |
| Release | autofab-webtest, finishing-a-development-branch, verification-before-completion |
| Git | finishing-a-development-branch, propose-skill |
| Docs | propose-skill |
| PM | propose-skill |
| Domain | timeweb-api |
| Cloud.ru | cloudru-object-storage, cloudru-terraform, propose-skill, Terraform, Terraform Cost Estimator |

Актуальное — всегда `multica agent skills list <id>`; эта таблица — снимок и «зачем».

## Внутренние скиллы сквада (наши, не из реестра)
- **autofab-webtest** — как тестировать портал живьём (webcheck/браузер+служебная сессия, Playwright, curl-API, нагрузка). Заведён 2026-07-08 под задачу «агенты сами смотрят сайт». См. `testing.md`.
- **autofab-devlab** — зонтичный скилл dev-лаборатории: vmatrix, lhaudit, a11y, loadtest, autocannon, pyan, umami-q, sandbox-db. Заведён 2026-07-10, роздан 16 агентам из 23. См. `testing.md`.
- **Гранулярные скиллы под те же CLI** (по одному инструменту на скилл, для точечной выдачи вместо зонтика):
  - **autofab-visual** — `vmatrix` (скрины mobile/tablet/desktop + diff-% против эталона).
  - **autofab-lighthouse** — `lhaudit` (perf/a11y/best-practices/seo).
  - **autofab-a11y** — `a11y` (axe: нарушения по severity + селекторы).
  - **autofab-load** — `loadtest` (k6: p95/p99, error-rate).
  - **autofab-data** — `pyan` (pandas/numpy/scipy/duckdb, dev-БД в `$DEV_DB`).
  - **autofab-analytics** — `umami-q` (поведение пользователей).
  - **autofab-sandbox** — `sandbox-db` (эфемерная postgres под миграции/запросы).
- **propose-skill** — процесс предложения нового скилла через CTO.
- **fleet-resources** — справочник по ресурсам флота (квоты 5ч/неделя + тренды + сбросы, реальные/теневые деньги, остаток ключа OpenCode, экономика лида vs направление, эффективность автопилотов) — куда идти диспетчерам/лидам за цифрой при планировании. Заведён 2026-07-17. См. `efficiency.audit.md` §6-7.

## Журнал решений
- **2026-07-08** — стартовый набор роздан (см. таблицу). Внешние тест-скиллы (E2E Testing Patterns, Performance Testing Toolkit, accessibility-auditor — clawhub.ai) импортированы под тестовый инструментарий команды. Слабым моделям (Git/Docs/PM/Cloud.ru) — только propose-skill, чтобы не топить короткий чеклист.
- **2026-07-10** — dev-лаборатория (8 CLI) развёрнута на dev-машине. Заведён зонтичный `autofab-devlab` и 7 гранулярных `autofab-*` скиллов под те же инструменты. Зонтик роздан 16 агентам из 23 (не получили: UX, Git, Docs, PM, Domain, Release, Cloud.ru — вне тест-контура либо слабая модель). Вердикт: к использованию.
- **2026-07-10 (CTO, ревизия)** — при приёмке доков вскрылись два дефекта, оба закрыты:
  1. Секция dev-лаборатории в `testing.md` описывала **выдуманные флаги** (`loadtest --rps/--concurrent/--duration`, `lhaudit --metric`, `a11y --level/--click`, `vmatrix --compare/--threshold`, `pyan --stat/--plot`, `umami-q --metric/--dimension`, `sandbox-db --template/exec`), несуществующие пути артефактов и неверные разрешения vmatrix. Особо опасен `loadtest`: он **молча глотает неизвестные флаги**, поэтому прогон по доке возвращал дефолтные 20 VU под видом заказанной нагрузки. Секция переписана по исходникам CLI.
  2. Заявление «снимок прод-БД без PII» про `sandbox-db` — неверно: `--from portal_dev` копирует dev-БД как есть, и база не удаляется сама.
  **Правило:** документируя CLI, сверяйся с исходником (`/usr/local/bin/*`, `~/autofab-tools/*`), а не с описанием скилла — описание рекламирует замысел, исходник знает реализацию.
- **Открытый вопрос (CTO, 2026-07-10)** — зонтик `autofab-devlab` дублирует 7 гранулярных скиллов, и 16 агентов носят их одновременно (QA/Front/Design — по 4-5 пересечений). Это лишний контекст в каждой задаче. Решить до следующей ревизии: оставить зонтик только «широким» ролям (CTO/Lead/QA), остальным — точечные скиллы. Дефолт, пока не решено: ничего не снимаем.

- **2026-07-17 (оператор, не CTO — прямое решение владельца флота)** — заведён `fleet-resources`
  (id `db45d211-4b46-4bd8-a725-96d63f2071c2`): справочник по новым метрикам ресурсов
  (квота-тренды/сбросы, экономика лидов, реальные деньги, остаток OpenCode-ключа),
  построенным в control.tasks.3mf.tech в этот же день. Роздан 22 агентам разом —
  весь bureaucracy-бакет (AgentOps, Board Curator, CTO, Forecast, Platform Guardian,
  Project, Git, Site Keeper, Dev Delivery, Release, Board Clerk, Duty Officer, Quota
  Sentinel, Contract Architect) + весь leadership-бакет (Lead, Fleet, Data, Fullstack,
  QA, Design, Growth, UX) — т.е. диспетчерам и лидам направлений, не исполнителям.
  Duty Officer ранее не имел ни одного скилла (`skills: []`) — теперь один.
  **Расхождение с правилом выше по этому же файлу**: обычно скиллы ставит только
  CTO через `propose-skill`; здесь решение и назначение сделал сам оператор напрямую
  через `multica agent skills add`, в обход обычного процесса — осознанно, это
  инфраструктурное решение уровня владельца флота, не внутрифлотская заявка.
  Вердикт: к использованию. **Замечено попутно**: таблица "Текущие назначения" выше
  в этом файле — снимок 2026-07-10, уже разошлась с живым `multica agent skills
  list` (пример: `autofab-devlab` числится у CTO в таблице, но реально снят) —
  не обновлял её в этом заходе, не в рамках этой задачи.

Новую запись добавляет CTO при каждом решении (поставил/снял/пилот): дата, агент, скилл, зачем, вердикт.
