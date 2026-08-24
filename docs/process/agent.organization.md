# Агентная организация: промпты, ресурсы и контроль

Этот документ объясняет, как создавать и менять агентов Multica, не разрушая организационный контракт [squad.multica.md](squad.multica.md).

## Инварианты каждого промпта

Промпт отвечает на девять вопросов: кто агент; кому подчиняется; какой результат ему принадлежит; какие документы он читает; что не входит в его полномочия; кому и в каком виде он передаёт работу; что является evidence; как выглядит эскалация; когда агент обязан ничего не создавать.

Общие правила: русский язык; `project=v1`; один parent и текущий владелец; приоритет, срок, acceptance и docs lineage; только удалённые `dev/main`. Код `portal.ru` готов после commit с MF, push в `origin/dev` и наблюдаемого результата на `dev.3mf.tech`. Код device-runtime в `UltraPrint` готов после commit с MF, push в `UltraPrint:dev`, simulator/contract-проверки и честного hardware evidence там, где заявлена поддержка. Документ, комментарий, макет или marker-коммит не заменяет реализацию.

**Внешний дизайн-агент — исключение из этих девяти инвариантов.** С 2026-07-18
оперативное дизайн-лидерство ведёт оператор напрямую с внешним чат-агентом (Claude
Code/Codex CLI, см. [squad.multica.md § «Design Studio»](squad.multica.md)). У него
нет промпта в Multica — девять вопросов выше к нему не применяются. В доске он
появляется только как автор/контекст карточки (описание, не assignee-с-промптом);
Design/Design Studio исполняют такие карточки как готовое решение, не переоткрывая
творческий выбор.

## Модели и параллелизм

| Тип роли | Модель | Thinking | Concurrency | Почему |
|---|---|---:|---:|---|
| CTO и стратегические лиды Headquarters | `gpt-5.6-terra` | high | 5 | решения с длинным горизонтом и конфликтами |
| Технические/дизайн специалисты | `gpt-5.6-luna` | medium | 50 | автономные проверяемые блоки |
| Простая проверка структурированных данных/контента | `gpt-5.4-mini` | low | 50 | дешёвая работа по строгой схеме |

Concurrency агента — верхняя граница, а не целевой WIP. Глобальный daemon/provider limit и доступная quota важнее. При низкой quota сохраняются CTO/Lead, Dev Delivery, Site Keeper и проверки; исследования и генерация новых направлений замедляются.

## Владение и запреты

| Роль | Владеет | Не владеет |
|---|---|---|
| Platform Guardian | философия, v1/v2/v3 boundaries | DNS, эксплуатация, код |
| Contract Architect | швы, schemas, versioning, auth/errors | реализация сервисов |
| Board Curator | WIP, метаданные, честный Done | продуктовые идеи |
| Forecast | critical path, P50/P80, ресурс | назначение разработчиков |
| AgentOps | prompts/squads/models/autopilots | продуктовая стратегия |
| Site Keeper | здоровье dev delivery chain | закрытие фич без evidence |
| Layout / Components / Page Composer | reusable UI structure | одноразовые экраны |
| Accessibility / Visual QA | независимая проверка live dev | субъективный redesign |
| Verifier / Telemetry Steward | trust evidence и event contracts | P2P v1 без решения CTO |
| Feedback Listener / Topic Keeper / Moderator | evidence и community knowledge | обещание roadmap |
| Catalog QA | provenance/schema audit | заполнение данных за автора |

## Шаблон взаимодействия

Каждое направление имеет три связанных вида истины:

- решение: документ и epic от Headquarters;
- контракт/реализация: child-карточки профильных сквадов;
- доказательство: commit, marker, URL, тест или структурированные данные.

Если одна часть отсутствует, работа не Done. Агент вправе создать подзадачу профильному специалисту, но обязан сохранить parent и вернуть итог исходному владельцу. Если спор меняет цель, агент не выбирает молча: CTO принимает продуктовый арбитраж, Contract Architect — seam, Design — experience, Fleet — device fact, Lead — implementation.

## Автопилот как событийный контроллер, а не генератор

У автопилота должны быть: один факт-сигнал, один владелец, threshold/cooldown,
fingerprint, максимальное число изменений, условие «ничего не делать» и точный
результат. Cron для LLM запрещён. CTO получает queue-starvation/quota-recovery;
Visual QA — coalesced web deployments; Site Keeper — только failure/health
transition; AgentOps — batch реальных runtime failures. Подробности —
[autopilots.event-driven.md](autopilots.event-driven.md).

После изменения промпта AgentOps проверяет старые слова-маркеры (`feature branch`, `PR`, merge в `main`, англоязычный шаблон), active triggers и способ отката. Конфигурация не считается завершённой, пока этот документ и [squad.multica.md](squad.multica.md) не отражают новую власть и handoff.
