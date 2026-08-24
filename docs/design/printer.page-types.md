# Типы страниц printer path — визуальный контракт v1

← [docs/design/readme.md](readme.md) · детали каталога — [printers.catalog.md](printers.catalog.md) · мастер — [printer.wizard.md](printer.wizard.md) · парк — [park.md](park.md) · живая морда — [printer.face.md](printer.face.md)

Это общий контракт для критического пути: `/printers` → `/printers/:slug` →
`/park/add` → `/park` → `/printer/:id`. Он не меняет UX-сценарий или API:
его задача — чтобы Front собирал экраны из одного словаря состояний и не
изобретал отдельный shell для каждой страницы.

## 1. Общие инварианты

- Канонический shell — тёмный тил/изумруд, зерно и стекло из
  [frame.md](frame.md), [palette.typography.md](palette.typography.md) и
  [components.md](components.md). Каталог, detail и park используют `full`
  shell; wizard и live-control — `ultra`/свой компактный chrome без
  центрального меню. Shell не должен становиться вторым hero.
- Контент центрирован, фиксированный chrome — overlay. На таче каждый action
  ≥48px, `:active` вместо hover, видимый `:focus-visible`. На ТВ весь порядок
  действий читается стрелками: фокус начинается с заголовка/первого элемента,
  primary — последний и очевидный.
- На каждом состоянии ровно один зелёный primary CTA. Back, retry, edit,
  docs и альтернативные выходы — glass/ghost. Если primary временно
  недоступен, он остаётся на месте disabled с причиной, а не исчезает.
- Состояние не кодируется только цветом: текст + `StatusPill`/иконка +
  семантический label. Ошибка остаётся рядом с причиной; не прячется в toast.
- Loading не сбрасывает уже показанные данные. Offline сохраняет последний
  снимок, но явно говорит, что он устарел. Анимация и звук следуют
  [motion.md](motion.md) и [sound.md](sound.md), отключаются при reduced motion.

## 2. Пять типов страниц

### Catalog — `/printers`

**Мысль экрана:** выбрать модель. Shell `full`, фасеты — вторичный слой,
`PrinterTile` ведёт в detail. Primary: «Добавить в мой парк» только когда
выбрана модель/открыта её quick action; в обычном каталоге не конкурирует с
поиском и карточками.

| Состояние | Что видно | Единственный следующий шаг |
|---|---|---|
| loading | shell + устойчивые skeleton плиток/фасетов | нет CTA до данных |
| ready | фасеты, сортировка, плитки, бейдж `support_level` | открыть карточку |
| empty | `EmptyState`: «Каталог пока пуст» + причина | «Сообщить о модели» (secondary, если нет данных для добавления) |
| offline | последний снимок + «Каталог обновится при подключении» | «Повторить» |
| error | компактная причина под toolbar, сетка не маскируется пустотой | «Повторить» |
| permission | публичный read не превращается в login-wall; если API требует сессию — объяснить доступ | «Войти» |
| success | после фильтра/добавления выбранная плитка получает `StatusPill`, без модалки | «Открыть мой парк» |

### Detail — `/printers/:slug`

**Мысль экрана:** понять совместимость и принять решение «У меня такой».
Hero/галерея сверху, затем характеристики, provenance и ограничения. Один
primary — «У меня такой»; он ведёт в `/park/add` с prefill и открывает сразу
шаг 2 мастера. Сравнение, share и «сообщить» — secondary.

| Состояние | Контракт |
|---|---|
| loading | skeleton hero и секций, не показывать ложный CTA |
| empty | модель не найдена/анонс: `EmptyState`, ссылка обратно в каталог |
| offline | последний detail + дата снимка; «У меня такой» можно показать только если данные модели полны |
| error | причина «Не удалось загрузить карточку» рядом с hero + «Повторить» |
| permission | публичные характеристики остаются видимыми; закрытые действия открывают login-overlay |
| success | после prefill мастер подтверждает выбранную модель chip-бейджем; не дублировать success-toast |

### Wizard — `/park/add`

**Мысль экрана:** выбрать способ подключения и довести его до enroll.
Одна колонка `Card` 560–620px, progress «Шаг 1 из 2», back к парку. Шаг 1
использует `PrinterPicker`; тап выбора сразу переводит на шаг 2. На шаге 2
пять уровней — один `radiogroup`, выбранный уровень раскрывает inline-панель.
Нельзя одновременно показывать два ярких CTA.

State machine: `model-loading → model-selected → method-selected →
checking/enrolling → success`; из `checking` возможны `offline` и `error`, из
`enrolling` — `expired` (с ghost «Сгенерировать новый»). `managed-*` и `custom`
без сессии — login-overlay, не silent disabled. `success` показывает бейдж
возможности и следующий шаг: «Открыть управление» для managed/custom, «Готово»
для list. Полный гейтинг и тексты — [printer.wizard.md §3–4](printer.wizard.md).

| Состояние | Визуальное правило |
|---|---|
| loading | progress сохраняется, активная панель skeleton |
| empty | модель не выбрана: picker с поиском, не пустой второй шаг |
| offline | IP-проверка объясняет «вы в одной сети?»; оставляет поле и manual path |
| error | ошибка под полем, лёгкий shake только группы поля, retry не toast |
| permission | login-overlay поверх мастера, введённое не теряется |
| success | чек-панель и один CTA следующего шага; код/модель не исчезают до перехода |

### Park / live-control — `/park`, `/printer/:id`

`/park` — список собственных устройств и точка выхода в управление; `/printer/:id`
— одна живая машина. Park использует `full` shell, live-control — `ultra` и
герой-сцену из [printer.face.md](printer.face.md). Primary park: «Добавить
принтер» только при пустом парке/в явном слоте; для строки принтера primary —
«Открыть управление». В live-control primary меняется только по сцене:
«Старт»/«Пауза»/«Продолжить», а «Стоп» требует confirm и coral-семантику.

| Состояние | Park | Live-control |
|---|---|---|
| loading | skeleton строк | hero skeleton, без ложного статуса |
| empty | `EmptyState` + «Добавить принтер» | не применяется без `id` |
| offline | последний статус + «офлайн» | последняя сцена замораживается, команды disabled с причиной |
| error | ошибка конкретной строки, остальные устройства живы | alert scene из `status.alerts.md`, retry рядом |
| permission | login-overlay/redirect по auth-контракту | login-overlay, не пустой экран |
| success | обновлённый `StatusPill` без скачка списка | подтверждение команды в сцене и sound feedback |

### Async-job — проверка, enroll, handoff

Это не отдельный роут, а полноэкранный/inline режим долгой операции. Использует
hero-иконку-кружок, не маленький spinner в углу. У операции есть `pending →
success | error | offline | expired`; progress не обещает процент, если backend
его не отдаёт. На `success` результат и один CTA видимы минимум до следующего
перехода. На `error` сохраняются ввод и выбранный метод; `retry` повторяет
без потери контекста. На `offline` показывается последний шаг и «Повторить».

## 3. Contract handoff между экранами

| Откуда → куда | Что передаём | Что нельзя делать |
|---|---|---|
| catalog → detail | `slug` | не подменять detail карточкой каталога |
| detail → wizard | `brand`, `model`, `slug` как prefill | не возвращать пользователя на picker без явного edit |
| wizard → park | `user_printer.id`, выбранный `link_source`, capability badge | не считать запись успешной до backend success |
| park → live-control | `user_printer.id` (не catalog slug) | не смешивать `/printer/:id` и `/printers/:slug` |
| live-control → async-job | operation id + printer id | не терять operation при reload/offline |

После каждого перехода back возвращает в исходное состояние и скролл, если
это технически возможно. Deep-link обязан открывать тот же тип страницы с
его loading/permission/error состоянием, а не вести на главную.

## 4. Приёмка Front

- Все пять типов явно мапятся на роуты выше и имеют семь состояний из таблиц.
- На desktop, touch и 10-foot нет второго равноправного зелёного CTA; все
  интерактивы ≥48px и доступны клавиатурой/пультом.
- `catalog slug` и `user_printer id` не смешиваются; prefill из detail и
  результат enroll проверяемы в URL/данных перехода.
- Ошибки/permission/offline не превращаются в пустой экран; последний
  полезный контекст сохраняется.
