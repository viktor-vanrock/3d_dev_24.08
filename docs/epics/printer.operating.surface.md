# Эпик MF-1193: reusable printer operating surface v1

**Статус:** direction ready, delivery parked by quota gate  
**Приоритет:** urgent / v1  
**Целевая дата:** 2026-07-14, доказанный результат в `origin/dev`  
**Владелец направления:** CTO Headquarters; delivery через Lead, доменные направления — Design, Fullstack, Data, Fleet и QA.

## Решение

`Printer operating surface v1` — не набор разовых экранов парка, мастера и морды
принтера. Это один повторно используемый операционный контракт: интерфейс показывает
только фактическую возможность конкретного соединения, объясняет её источник и
границу, а команда и статус имеют наблюдаемый исход. UI остаётся reference-клиентом
публичного/нормализованного API, а не создаёт отдельную модель управления.

Это усиливает платформу, а не вертикаль: один словарь capability, свежести,
доступности и command-feedback покрывает новые драйверы и модели без ручного
переизобретения экрана на каждый принтер. Данные о соединении и исходах команд
остаются входом в data flywheel; непокрытые модели получают честные API/community
выходы, а не ложное обещание поддержки.

## Документы-основания (lineage)

| Документ | Релевантный раздел | Снимок lineage |
|---|---|---|
| `docs/product/platform.md` | «API-first», «Сеть и база как ядро», «Правило масштаба» | `0e722cb` \| plag \| 2026-07-10 |
| `docs/product/ux.md` | §6 «Обещание портала ≤ того, что реально может» | `425e201` \| Docs \| 2026-07-11 |
| `docs/design/readme.md` | «Философия и логика», `StatusDot`/`StatusPill`, touch/10-foot | `82a898d` \| Design \| 2026-07-12 |
| `docs/epics/printer.support.md` | «Сценарий “добавить принтер”», «Гейтинг уровней по модели», pass/fail | `2d7f8fd` \| Data \| 2026-07-12 |
| `docs/architecture/printer.server.md` | §1 NAT, §2.2 `PrinterDriver`, §2.4–2.5 telemetry/commands, §3 planes | `2ca2af7` \| Back \| 2026-07-15 |
| `docs/process/headquarters.documentation.md` | «Council Design–UX–Fleet», «Проверка перед delivery» | `0df14d7` \| Docs \| 2026-07-12 |

При изменении любого источника владелец направления повторно сверяет семантику и
обновляет lineage в своей parent-карточке; этот эпик не заменяет технический факт
Fleet, решение UX или дизайн-спеку.

## Граница v1: честные состояния и соединения

| Контекст | Что честно обещает operating surface | Что он не имеет права обещать |
|---|---|---|
| `list` | Модель есть в каталоге; доступны сведения и внешние пути | Живое состояние или команды |
| `managed-local` | Браузер говорит с локальным API принтера, пока пользователь в той же LAN | Удалённое облачное управление или доступ сервера к LAN-IP |
| `managed-cloud` | Связь и команды проходят через облако вендора, с его статусом/ограничениями | Прямой LAN-доступ и независимость от облака вендора |
| `managed-bridge` | Наш лёгкий агент создаёт outbound-канал через NAT без смены прошивки | Наличие моста до enroll/подтверждённого соединения |
| `custom` | Наш агент и визуал на совместимом устройстве дают полный контур | Безопасную однотапную прошивку или поддержку неподготовленной модели |

NAT, права, истёкший enroll, offline/stale telemetry и отказ команды — разные факты.
Ни один из них не сворачивается в безымянный «офлайн». Источник состояния, возраст
данных, доступность действия и recovery-путь должны быть доступны одновременно
пользователю и API-клиенту.

## Reusable patterns v1

1. **Capability badge** — уровень и транспорт (`local`/`cloud`/`bridge`/`custom`),
   ограничение и причина недоступности; бейдж используется в каталоге, мастере,
   парке и live-control.
2. **Operating state** — нормализованное представление `live`, `stale`, `offline`,
   `permission-required`, `setup-pending`, `error`; каждое содержит источник,
   timestamp/freshness и человекочитаемую причину.
3. **Command feedback** — команда проходит видимые состояния `available → pending
   → acknowledged | rejected | timed-out`; повтор не создаёт дубликат и не
   утверждает успех до подтверждения драйвера.
4. **Honest recovery panel** — одно primary-действие, сохранённый контекст,
   безопасный retry и альтернативный путь; для NAT — LAN-инструкция без совета
   открывать порт.
5. **Control density** — `StatusDot`/`StatusPill`, крупные тач-цели, яркость
   соответствует срочности; keyboard/TV focus и reduced motion не являются
   вторым классом.

Названия и точные поля контракта утверждают Fleet и Data; Design фиксирует
каноническую визуальную/interaction-спеку, Fullstack реализует только после этого.

## Зависимости и волны

| Wave / stage | Результат и зависимость | Владелец |
|---|---|---|
| 0 — admission | Свежий quota-снимок, нет `~/.quota-paused`, занятые файлы и capacity подтверждены. Без этого дочерние code-карточки остаются `backlog`. | Lead |
| 1 — facts and contract | Fleet даёт матрицу transport/state/latency/command semantics; Data подтверждает persistence/event boundary; Design+UX превращают только подтверждённые факты в паттерны. | Fleet → Data/Design |
| 2 — implementation slices | Fullstack создаёт независимые API/UI slices по утверждённому контракту; Design/Front реализуют паттерны; конфликт файлов разрешается через Lead. | Fullstack / Design |
| 3 — prove on dev | QA проверяет все пять capability-контекстов, error/recovery, touch/keyboard/TV и отсутствие ложных обещаний; Dev Delivery принимает evidence из `origin/dev`. | QA → Dev Delivery |

Каждая direction-карточка обязует своего лида создать первую волну из **4–8
содержательных delivery-карточек** исполнителям. Одна карточка включает связанные
шаги реализации, тестирования, документации и evidence при общем владельце и
результате; отдельная child нужна для другого владельца, stage, deploy или блокера.
Это только старт: лиды и исполнители
могут создавать subtask, переназначать владельца и расширять waves. При расширении
лид обновляет parent с причиной, ресурсом, файловым/контрактным конфликтом и
влиянием на priority, срок и зависимость. Изменение стратегии либо границы
`PrinterDriver` эскалируется CTO. Обязательная цепочка: **Fleet technical fact →
Design reusable pattern → Front implementation**.

## Ресурс и quota budget

Снимок 2026-07-12: Codex 5-hour окно почти исчерпано (`u5=0.91`), недельное
окно доступно (`u7=0.14`); Claude отклоняет работу по семидневной квоте
(`u7=1.0`, reset 2026-07-16). Поэтому сейчас допустима только подготовка и
парковка направлений; старт Wave 1 требует нового чтения
`/home/plag/codex-quota.py --json`, `/home/plag/claude-quota.py --json` и
`~/.quota-paused`.

После восстановления: не более одной независимой первой волны в работе на
направление и не более доступной capacity исполнителей; сначала Fleet/Data
facts, затем Design/UX, затем Front. Lead обязан оставить в parent фактический
лимит, активных исполнителей и конфликтующие файлы до создания `todo`-детей.

## Риски и меры

| Риск | Мера / владелец |
|---|---|
| LAN-IP ошибочно выглядит как удалённое управление | Везде показывать источник и LAN-boundary; QA негативно проверяет NAT-copy. |
| UI предполагает state/ack, которых нет у драйвера | Fleet публикует факты до Design; Fullstack не вводит optimistic-success без подтверждения. |
| Разные экраны дрейфуют по словарю статусов | Design ведёт единый pattern; review запрещает локальные синонимы и новые status-color без спецификации. |
| Telemetry устаревает или команды дублируются | Data/Fleet задают freshness и idempotency boundary; QA проверяет stale/timeout/retry. |
| Quota или конфликт файлов создаёт ложную параллельность | backlog admission, явный quota snapshot и file ownership в каждой child-карточке. |

## Критерий dev-успеха

Эпик готов к приёмке, когда:

- в `origin/dev` есть commit(ы) с `MF-1193`, без изменения `main`, и Dev Delivery
  дал ссылку на проверяемый результат;
- один канонический capability/state/command-feedback контракт применяется в
  каталоге или мастере, парке и live-control, а не копируется по экрану;
- QA на `dev.3mf.tech` доказал honest-flow для `managed-local`, `managed-cloud`,
  `managed-bridge`, `custom` и безопасного `list`-fallback, включая stale,
  permission, command rejection и NAT recovery;
- Fleet подтвердил, что отображаемые состояния и исходы команд имеют реальный
  источник в connector/relay contract; Data подтвердил schema/event boundary;
- все новые документы и карточки содержат lineage, scopes, dependencies и
  evidence; нерешённый архитектурный спор возвращён CTO, а не скрыт в UI.

## Handoff

CTO создаёт шесть parked direction-карточек: Lead (delivery/admission), Fleet
(факты и connector boundary), Data (state/event boundary), Design (reusable
pattern), Fullstack (implementation slices) и QA (dev evidence). После quota
recovery каждый владелец создаёт свою первую волну из 4–8 delivery-карточек с parent на
direction; Lead координирует stage-переходы и передаёт только доказанный HEAD:dev
в Dev Delivery.
