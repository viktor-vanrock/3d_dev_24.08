# Аудит UI-паттернов живых экранов

← [Дизайн-система](readme.md) · карточка MF-1048 · основание: [components.md](components.md),
[layout.md](layout.md), [ux.principles.md](ux.principles.md)

## Ратификация hover-канона (MF-1885)

По ~70 находкам с dev.3mf.tech (разнобой формы кнопок/табов, «мёртвые» на вид кликабельные
элементы, конфликт бейджа и кнопки за один угол карточки — MF-1884): решение — существующая
система `.pressable` + `@media (hover:hover) and (pointer:fine)` (`theme/tokens.css`, `ui/ui.css`,
канон [components.md](components.md) § «Канон геометрии и состояний контролов»). Новый
hover-паттерн не изобретаем. Канон «тач-первый» ([readme.md](readme.md) § «Философия и логика»,
п. 5) не пересматривается: hover остаётся необязательной надстройкой для мыши/тачпада
(`pointer: fine`), `:active` для тача — основной канал обратной связи. Находки ниже — не про
отсутствие hover-системы, а про экраны, ещё не переведённые на общие примитивы `ui/ui.tsx`
(хардкод локальных `<button>`/`<div onClick>`), из-за чего форма/геометрия и разъезжаются.

## Срез 2026-07-18: принтеры, проекты, лента, профиль, сообщества (продолжение MF-1884)

Проверяемые контуры — находки с 43 аннотированных скриншотов dev.3mf.tech (см. MF-1884):
`/printers` (каталог, карточка, `/printers/compare`), `/projects` (каталог, страница проекта),
`/feed`, профиль (`market/profile.*` + `home/profileedit.tsx`), сообщества/форум
(`community/communitylist.tsx`, `communityscreen.tsx`, `feed/threadscreen.tsx`… см. также
`community/threadscreen.tsx`). Владелец миграции для всех строк — **Front** (владеет
`market/projects/printers/park/feed/community/generate/home` по разбору MF-1886); примитивы
`ui/ui.tsx` остаются за **Components**. Header (шапка) сюда не входит — 4 легитимных режима
шапки фиксируются отдельной карточкой аудита хедера, а не этой таблицей.

| Экран | Владелец | Сейчас | На UI-kit |
|---|---|---|---|
| `/printers` — каталог (`printersscreen.tsx`, `printertile.tsx`) | Front | Compare-чекбокс на тайле — нативный `<label><input type="checkbox">` (18×18, свой радиус); сортировка/«Фильтры (N)»/facet-строки бренда — самодельные pill/rect-кнопки; очистка facet-поиска ✕ без `.pressable`; FleetBar-ссылка и MobileFilterSheet (закрыть/CTA) — ручная разметка `uiButton` в обход компонента | `Switch`/`Chip` для compare-toggle и facet-строк, `Button`/`IconButton` для сортировки/фильтров/очистки/FleetBar/шита — единая геометрия и hover из коробки |
| `/printers/:id` — карточка принтера (`printerdetailscreen.tsx`) | Front | «В сравнении» — ручная circle-кнопка 44×44; «Сообщить о проблеме» (`ContextFeedbackDoor`) — свой класс `cfbDoor`; «Это мой принтер»/«Дозаполнить карточку» — плоские текстовые кнопки; локальный `:hover`-тint на `.prnHeroCompare` дублирует `.pressable` | `IconButton` для «В сравнении», `Button ghost`/`Chip` для feedback/дозаполнить; убрать дублирующий hover/focus-ring |
| `/printers/compare` (`comparescreen.tsx`, `comparepanel.tsx`) | Front | Удаление колонки ✕ и «+ Добавить принтер» — raw `<a>`/div без `IconButton`/`SelectionTile`; ComparePanel «Сравнить» и мобильный «Сравнить (N)» — ручной `uiButton`/pill; локальный focus-ring переопределяет глобальный токен | `IconButton` для ✕, `SelectionTile`/`ActionCard` для add-column тайла, `Button` для «Сравнить» |
| `/projects` — каталог (`projectspage.tsx`, `hero.tsx`) | Front | Popular-tag чип, «Сбросить фильтры», «Показать ещё» — ручные кнопки с локальным hover/focus поверх `.pressable` (двойной механизм); hero-точки (circle) и hero slide CTA (pill) — свои классы | `Chip`/`SelectionTile` для popular-tag, `Button` для reset/show-more, `IconButton`/`Chip` для hero-точек и CTA |
| Страница проекта (`market/model.tsx`) | Front | Все действия — один локальный класс `.modelGlassBtn` (pill 999px, 48px): «В каталог», ссылка автора, «Отправить в печать», «Поделиться», «Сделать копию», owner-действия (Редактировать/Опубликовать/Удалить), варианты `DownloadButton`. Ни один `Button`/`IconButton`/`ActionCard`/`SelectionTile`/`Switch` не используется для этих действий (`Chip` — только у тегов) | `Button` (primary/secondary/ghost вариантов достаточно) для всех перечисленных действий, `IconButton` для author/share-аффорданса |
| `/feed` (`feedscreen.tsx`, `postcard.tsx`, `vote.tsx`) | Front | «Показать ещё» и `ExpandPill` «Раскрыть/Свернуть» — ручные pill-кнопки; vote up/down (`vote.tsx`) — полностью локальный `feedVoteBtn`, не `IconButton`; три формы одного смыслового действия на экране: десктопная «Написать пост» (`Button`, squircle 12px) vs мобильный FAB (circle) vs табы `SegmentToggle` (pill); hover карточки поста красит рамку в акцентный оттенок, а не просто темнеет | `Button`/`Chip` для show-more/expand, `IconButton` для vote и FAB (привести FAB к той же геометрии, что десктопная кнопка), унифицировать hover карточки под `.pressable` |
| Профиль (`market/profile.tsx` + `profile.activity.tsx`/`profile.catalogs.tsx`/`profile.push.tsx`) | Front | «В каталог»/«Показать ещё» (модели/идеи/принты) — pill `modelGlassBtn`/`marketShowMore`; строки идей/принтеров/филаментов и push-toggle-строки — `<div role="button">` (`ideaRow`, rect 16px) вместо кликабельного примитива | `Button` для CTA/show-more, `SelectionTile`/`ActionCard` для кликабельных строк (idea/printer/filament/push-row) |
| Профиль — редактирование (`home/profileedit.tsx`) | Front | Уже полностью на `Button`/`Input` — миграция не требуется, фиксируем как готовый образец | — (готово) |
| Сообщества/форум (`community/communitylist.tsx`, `communityscreen.tsx`, `feed/threadscreen.tsx`, `feed/vote.tsx`) | Front | «Вступить»/«Выйти» — геометрия уже совпадает через общий `.uiButton`+`data-variant` (не расходится в CSS), но разметка ручная в обход `<Button>` (нет `loading`/`aria-busy` из коробки); «+ Новый тред», «Пожаловаться»/«Ответить»/«Отметить принятым», карточки списка — тот же ручной `uiButton`/`cmtyPostActionBtn`; отправка ответа берёт чужой `modelGlassBtn` (999px), расходится с `--button-radius`; vote up/down — свой `feedVoteBtn`; мобильный FAB «Создать сообщество» — свой circle | Заменить ручную разметку на прямой `<Button variant=…>` (вступить/выйти/новый тред/действия треда), `IconButton` для vote/FAB, привести кнопку отправки к `--button-radius` через `Button` |

## Приёмка среза

- «Вступить»/«Выйти» — геометрия уже канонична (общий `--button-radius`/`--button-height` через
  `data-variant`), это НЕ находка про форму; находка — обход компонента `Button` самой разметкой.
  Значит для этой пары в этапе 2 меняется только markup (замена на `<Button variant=…>`), не CSS.
- Три формы «Написать пост» (squircle/circle/pill в табах на `/feed`) и разнобой на `/printers`
  (circle compare vs pill sort vs rect facet-row) — конкретные проявления находки 4 из
  MF-1884/скриншотов: «кнопки либо круглые, либо квадратные везде, так и так быть не может».
  Этап 2 приводит семейство действий на каждом экране к одной геометрии через общий примитив,
  а не переизобретает форму заново под каждый экран.
- Header (шапка) — вне этой таблицы: 4 легитимных режима шапки фиксируются отдельной карточкой
  аудита хедера, здесь не подгоняем шапку под общий паттерн вслепую.
- Владелец каждой строки — Front (см. разбор MF-1886); примитивы `ui/ui.tsx` — зона Components,
  правки экранов согласуются с Front построчно, не одной гигантской правкой сразу.

## Срез 2026-07-17: каталог материалов

Проверяемый контур — `/materials` и `/materials/:id`. Это один пользовательский поток и один
набор файлов `apps/web/src/materials/`. Живой просмотр `dev.3mf.tech` подтвердил доступность
маршрутов, но содержимое закрыто `AuthGate`: служебная сессия рантайма истекла, а локальный
`autofab-session-refresh` не получил `JWT_SECRET`. Поэтому геометрия контролов сверена по
рендер-тестам и CSS, а после публикации требуется повторный authenticated webcheck.

| Экран | Сейчас | На UI-kit |
|---|---|---|
| `/materials` — поиск и текстовые фильтры | Локальные `input` и кнопки очистки; очистка 40px | `Input` + `IconButton`, единый input/icon tier, цель 48px (64px TV) |
| `/materials` — выбор класса | Четыре локальных toggle-кнопки со своей selected-заливкой | `Chip`: галочка + акцентная рамка + `aria-pressed`, без отдельной геометрии |
| `/materials` — активные фильтры | Локальные чипы удаления высотой 36px | `Button secondary`, цель 48px и общий `focus-visible` |
| `/materials` — reset/load more/retry/mobile sheet | Пять локальных вариантов кнопки | `Button`/`IconButton`, состояния `disabled`/`aria-busy` остаются нативными |
| `/materials/:id` — назад/раскрыть варианты | Локальные текстовые кнопки | `IconButton`/`Button ghost`, общий press/focus/touch контракт |

## Приёмка среза

- В `materialsscreen.tsx` нет заинлайненных `<button>` и `<input>`: интерактивы собраны из
  `apps/web/src/ui/ui.tsx`.
- В `materialdetailscreen.tsx` нет заинлайненных `<button>`: все действия используют `Button`.
- Минимальная цель берётся из `--button-height`/`--icon-button-size`: 48px по умолчанию, 64px в
  10-foot tier.
- Клавиатурный фокус берётся из глобального `:focus-visible`; selected-класс материала имеет
  нативный `aria-pressed` компонента `Chip`.

## Срез 2026-07-18: голосовалка (MF-1889)

Ревьюер трижды независимо не понял «▲/▼ + счётчик» без подписи: карточки проектов в каталоге,
страница проекта рядом со счётчиком печатей, лента новостей, список тредов форума, страница
треда. Проверка кода (не только скриншотов) — **компонентного дублирования нет**: ровно два
переиспользуемых примитива на весь портал, оба задокументированы в [components.md](components.md)
§«Голосовалка»:

- **`ui/vote.tsx` `Vote`** — только апвоут (идеи, `#/issue*`), три варианта compact/large/inline.
- **`feed/vote.tsx` `VoteArrows`** — вверх/вниз, один компонент на пять `subjectType`
  (`feed_post`/`feed_comment`/`thread`/`post`/`model`); MF-931 явно отказалась заводить третью
  копию JSX/CSS при добавлении thread/post. Каталог, страница проекта, лента и форум зовут этот
  же компонент — не локальные копии.

Проблема не в дублировании, а в том, что **видимая подпись «Рейтинг»/«Голоса» показывается не во
всех местах, где стоит `VoteArrows`** — `data-labeled`/подпись в `feed/vote.tsx` включена только
для `subjectType==='feed_post'` (`feed/vote.tsx:126,141`), остальные подтипы получают только
`aria-label` (незряч для зрячего первого посетителя — ровно жалоба ревьюера).

| Место | Компонент/вызов | Видимая подпись сейчас | Статус |
|---|---|---|---|
| Карточка каталога проектов (`market/market.tile.tsx:75`) | не `VoteArrows` — текст `Голосов: {votes_up-votes_down}` | есть | исправлено (MF-1746, `aeae12b`) |
| Лента новостей, пост (`feed/postcard.tsx` → `feed/vote.tsx`, `subjectType=feed_post`) | `VoteArrows` | есть, подпись «Рейтинг» | исправлено (MF-1751, `26882b8`) |
| Список тредов форума (`community/communityscreen.tsx:313-325`) | `VoteArrows subjectType=thread` | есть, соседний `<span class="cmtyThreadCardVoteLabel">Голоса</span>` | исправлено (MF-1756, `fe1e0bb`) |
| **Страница проекта** (`market/model.tsx:413-425`) | `VoteArrows subjectType=model`, вариант compact | **нет** — голая стрелка+число рядом с кнопкой «Скачать»; на той же странице отдельно живёт вкладка «Напечатали» (`model.stats.tsx`) — два разных числа без подписи неотличимы | **открыто** |
| **Страница треда форума**, шапка треда (`community/threadscreen.tsx:207-217`) | `VoteArrows subjectType=thread`, вариант large | **нет** | **открыто** |
| **Страница треда форума**, каждый ответ (`community/threadscreen.tsx:440-448`) | `VoteArrows subjectType=post`, вариант compact | **нет** | **открыто** |
| Комментарий в ленте (`feed/commenttree.tsx:159`) | `VoteArrows subjectType=feed_comment` | нет (ниже приоритет — комментарий уже в контексте подписанного поста) | не блокер |

**Рекомендуемый фикс** (реализация — Front, вне зоны `ui/`): убрать `feed_post`-гейт на подпись в
`feed/vote.tsx` — показывать «Рейтинг» тем же образом для `model`/`thread`/`post` (переиспользовать
контракт `cmtyThreadCardVoteLabel`/`feedVoteCaption`, не заводить третий вид подписи). Это
закрывает оставшиеся 2 из 5 мест одним изменением контракта компонента + точечной разметкой в двух
экранах. Заведена дочерняя карточка на Front.

### Приёмка среза

- Один компонент (`Vote` или `VoteArrows`) на весь смысловой класс — подтверждено, копий не
  найдено.
- Открытый разрыв — не дублирование, а неполный охват уже принятого визуального контракта
  «видимая подпись у голосовалки» тремя более ранними фиксами (MF-1746/1751/1756); карточка
  MF-1889 закрывается фиксом оставшихся двух экранов.
