# Витрина мастера: визуальная дельта (шапка, соц-хедер, кнопки, парк оборудования)

← [docs/design/readme.md](readme.md) · UX-сценарий (поток/логика, принят) — [storefront.master.md](storefront.master.md)
· примитивы — [ui/ui.tsx](../../apps/web/src/ui/ui.tsx) / [ui/ui.css](../../apps/web/src/ui/ui.css) ·
паттерн строки-каталога — [profile.catalogs.md](profile.catalogs.md) · база (устарела, см. `storefront.master.md`
§0) — [marketplace.full.md §7](marketplace.full.md)

**Что это.** Визуальная дельта Design (**MF-1848**) поверх принятого сценария
[storefront.master.md](storefront.master.md) (MF-949) для Фазы 1 эпика [MF-30](mention://issue/6464e1a4-10cf-4b1c-a019-8f90c8468d96)
(реализация — [MF-399](mention://issue/1efd18cd-e6bb-4037-b67b-9f253647abdd)). Тот файл фиксирует ЧТО показывается
и КОМУ (владелец/гость, честные состояния) — этот фиксирует, КАК это выглядит: композиция внутри
`ProfileScreen`, порядок блоков, токены, конкретные CSS-классы. Покрывает §2 (шапка), §4 (соц-хедер), §5 (ряд
кнопок), §6 (парк оборудования), §8 (матрица) сценария — ровно объём этой карточки.

**Зона.** Только визуал, реализует Front. Схему/API/RBAC не пересматриваю — MF-399 (Back/Data) остаётся
источником истины по полям `is_master`/`master_profile.{city,slogan}`/`member_since`. Всё — на существующих
примитивах ([ui/ui.tsx](../../apps/web/src/ui/ui.tsx)) и токенах (`theme/tokens.css`); где не хватает — **GAP**
(§7).

---

## 0. Что не меняется

Проверено по `apps/web/src/market/profile.tsx` (`ProfileScreen`) на `dev`, коммит `dd8e2b6`. Эта дельта рендерится
**только когда `profile.is_master === true`** (сценарий §1) — для обычного автора `ProfileScreen` не трогается
ни на одну строку, весь раздел ниже описывает исключительно мастер-ветку.

Не переверстываю: `HomeHeader`, галерею проектов (`ModelTile`/карусель/`marketShowMore`), секции «Мои идеи»/
«Мои печати» (own-only, `profile.activity.tsx`), `PushSettingsSection`, механику бейджей/подписки (MF-993 —
только переставляю кнопку «Подписаться» визуально, логика `toggleFollow`/`followUser` не трогается).

---

## 1. Композиция страницы (порядок блоков)

Сегодня (`profile.tsx:261-467`): `Card.profileCard` → `AccountEditor` (own) → заголовок+галерея проектов →
«Мои идеи» (own) → «Мои печати» (own) → `MyCatalogsSection` (own) → `PushSettingsSection` (own).

**Мастер-ветка** (`profile.is_master === true`) вставляет два новых блока между карточкой и галереей проектов,
и разводит `AccountEditor`/ряд кнопок по владельцу/гостю:

| # | Блок | own (мастер смотрит свою витрину) | гость (смотрит витрину мастера) |
|---|---|---|---|
| 1 | `Card.profileCard` (шапка) | без кнопки «Подписаться» (как сегодня) | без кнопки «Подписаться» **внутри карточки** — переехала в блок 3 |
| 2 | **Соц-хедер** — новый, `StatTileGrid` (§4) | видно | видно |
| 3 | `AccountEditor` **или** **ряд кнопок** (§5) | `AccountEditor` (2 новых поля) | ряд «Заказать/Написать/Подписаться» |
| 4 | Галерея проектов | без изменений | без изменений |
| 5 | «Мои идеи»/«Мои печати» | без изменений (own-only, гость их и так не видел) | не видит (как сегодня) |
| 6 | **Парк оборудования** (§6) | видно, own-режим (add/edit) | видно, read-only |
| 7 | `PushSettingsSection` | без изменений | не видит (как сегодня) |

Блок 3 — **одна и та же позиция в потоке**, разное содержимое по `own`: это не два новых места на странице, а
развилка внутри уже существующей позиции (`profile.tsx:312`, сегодня там только `AccountEditor`).

---

## 2. Шапка — город/слоган (сценарий §2)

`Card.profileCard` (`profile.tsx:262-310`) сегодня: `.profileAvatar` → `<div>`{`Heading` → `.profileUsername` →
`.profileBadges`? → `.profileBio`? → `.profileLinks`? → `.profileCount`} → кнопка «Подписаться» (own ? null : …).

Вставляю два опциональных ряда **между `.profileUsername` и `.profileBadges`** (`profile.tsx:272-273`) — город и
слоган образуют компактный двухстрочный «идентити-блок» сразу под ником, badges/bio/links ниже не сдвигаются
по смыслу, только физически ниже на 0-2 строки:

```
Heading (display_name)
.profileUsername (@username)
.profileLocation  — НОВОЕ, рендерится если profile.master_profile?.city
.profileSlogan    — НОВОЕ, рендерится если profile.master_profile?.slogan
.profileBadges?   — без изменений
.profileBio?      — без изменений
.profileLinks?    — без изменений
```

**Токены (`profile.css`, рядом с `.profileUsername`):**

```css
.profileLocation {
  color: var(--text-dim);
  font-size: 13px;   /* на 1px мельче .profileUsername (14px) — держит иерархию имя > ник > город */
  margin-top: 2px;
}

.profileSlogan {
  color: var(--text-dim);
  font-size: 12.5px;
  font-style: italic;
  margin-top: 2px;
  max-width: 40ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Оба — обычный текст (сценарий §2.2: «без намёка на интерактивность, без `:hover`/`cursor:pointer`»), никаких
новых компонентов. Слоган — одна строка, обрезка эллипсисом при переполнении (сценарий явно требует ≤80 симв.,
`max-width: 40ch` — дополнительная физическая страховка на случай длинных моноширинных символов).

### 2.1 Лого (аватар) — копирайт для мастера

Кроп-флоу не меняется (`accounteditor.tsx` `AvatarCropper`, без изменений). Меняется только подпись кнопки
загрузки (`accounteditor.tsx:125-133`, сегодня «Загрузить фото» / «Загрузка…»):

- `profile.is_master === true` → «Загрузить лого» (busy-состояние остаётся «Загрузка…», не меняется).
- иначе → «Загрузить фото», без изменений.

### 2.2 `AccountEditor` — Город/Слоган (own, сценарий §2.1)

Новые поля вставляются **между «Имя» и «О себе»** (`accounteditor.tsx:138-163`) — порядок формы зеркалит
порядок чтения (§2): Аватар/Лого → Имя → **Город** → **Слоган** → О себе → Сайт → Контакты → «Сохранить».
Рендерятся только при `profile.is_master === true` — иначе форма не меняется вообще.

Та же анатомия поля, что уже есть у «Имя»/«Сайт» (`fieldLabelStyle` + `Input`, `accounteditor.tsx:357-363`):

```tsx
<div style={{ marginBottom: 12 }}>
  <label style={fieldLabelStyle} htmlFor="ae-city">Город</label>
  <Input id="ae-city" value={city} onChange={...} placeholder="Например, Москва" maxLength={60} />
</div>
<div style={{ marginBottom: 12 }}>
  <label style={fieldLabelStyle} htmlFor="ae-slogan">Слоган</label>
  <Input id="ae-slogan" value={slogan} onChange={...} placeholder="Короткая фраза о вашей ферме" maxLength={80} />
</div>
```

Сохранение — тем же `handleSave`/`PATCH /me`, тихий успех/`toast`-ошибка, что уже верно для остальных полей
(сценарий §2.1) — GAP-DATA: `ProfilePatch`/`PATCH /me` должен принимать `city`/`slogan` (Back, MF-399).

---

## 3. Соц-хедер — `StatTileGrid` (сценарий §4)

Заменяет `.profileCount` (`profile.tsx:297-299`) **только для мастера**. Для `is_master === false` `.profileCount`
остаётся ровно как сегодня, внутри карточки.

Для мастера `.profileCount` **убирается из `Card`** — три метрики физически не помещаются в горизонтальную
строку карточки (аватар | текст | кнопка) без переверстки самой карточки, а плитка `StatTile` — блочный
элемент с паддингом `clamp(16px,3vw,24px)`, не инлайн-текст. Вместо переверстки карточки — новый full-width
блок **сразу под `Card`** (позиция 2 в §1), тот же приём, что уже даёт `.uiStatTileGrid` в статистике модели
(`model.card.visual.md §4`):

```tsx
{profile.is_master ? (
  <div className="uiStatTileGrid">
    <StatTile label="Рейтинг" value={ratingValue} tone={ratingTone} />
    <StatTile label="Выполнено" value={completedCount} tone={completedCount > 0 ? "ok" : "dim"} />
    <StatTile label="На портале с" value={memberSinceLabel} tone="ok" />
  </div>
) : (
  /* .profileCount — без изменений */
)}
```

Без обёрточного `Eyebrow`-заголовка над рядом (в отличие от вкладки «Статистика» модели) — плитки читаются
сами по себе сразу под шапкой, четвёртый безымянный заголовок подряд (после Card) перегрузил бы вертикальный
ритм; `StatTile` уже несёт подпись внутри себя (`Eyebrow` в самом компоненте, `ui.tsx:602`).

| Плитка | `value` | `tone` |
|---|---|---|
| Рейтинг | `avg(rating)` либо честная строка **«Отзывов пока нет»** вместо числа (сценарий §4, 0 отзывов) | `dim` пока нет отзывов, `ok` как только есть |
| Выполнено | `count(print_requests where status='done')`, сегодня всегда `0` (сценарий §4) | `dim` при `0`, `ok` при `>0` — токен `StatTile` уже даёт это автоматически, доп. логики не пишем |
| На портале с | `member_since` (формат «2026») | `ok` — не читалка честности «пока нет данных», факт есть всегда |

Read-only для обеих ролей (сценарий §4 — «агрегаты чтения») — `StatTile` без `onClick` (GAP-CSS-кликабельный
вариант из `model.card.visual.md §6.1` здесь не нужен, ни одна из трёх плиток никуда не ведёт).

---

## 4. Ряд кнопок «Заказать / Написать / Подписаться» (сценарий §5)

Видим только гостю мастера (`profile.is_master && !own`), позиция 3 в §1 — там же, где у владельца в этот
момент рендерится `AccountEditor`. Новый класс `.profileActionRow` (`profile.css`, рядом с `.profileProjectActions`):

```css
.profileActionRow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 480px) {
  .profileActionRow {
    flex-direction: column;
  }
  .profileActionRow .uiButton {
    width: 100%;
  }
}
```

Три `Button` из `ui/ui.tsx`, без новых обёрток, порядок и variant — как в заголовке сценария §5:

```tsx
<div className="profileActionRow">
  <Button variant="primary" onClick={() => comingSoon(overlay, "Отправка заявки мастеру")}>Заказать</Button>
  <Button variant="secondary" onClick={() => comingSoon(overlay, "Чат с мастером")}>Написать</Button>
  <Button
    variant="secondary"
    onClick={() => void toggleFollow()}
    disabled={followPending}
  >
    {profile.is_following ? "Вы подписаны" : "Подписаться"}
  </Button>
</div>
```

`comingSoon()` — существующий паттерн честной заглушки `home/personahome.tsx:40`, тексты — по сценарию §5 (не
дублирую здесь, см. таблицу сценария).

**Важная визуальная развилка от сегодняшнего поведения:** у обычного (не-мастера) профиля кнопка
«Подписаться» сегодня переключает `variant` между `primary`/`secondary` в зависимости от `is_following`
(`profile.tsx:303`, «была primary, когда одна» — сценарий §5) — **эта ветка не меняется**. Внутри
`.profileActionRow` мастер-профиля «Подписаться» **всегда `secondary`**, независимо от `is_following` — в
ряду из трёх кнопок primary держит только «Заказать» (сценарий §5, «одна дверь»). Два разных места
рендерят один и тот же семантический элемент по-разному — это не рассинхрон, а два самостоятельных UI-контекста
(одна кнопка на карточке vs кнопка в ряду действий), логика `toggleFollow`/`is_following` общая, différence
только в `variant`.

---

## 5. Парк оборудования (сценарий §6)

`MyCatalogsSection` (`profile.catalogs.tsx`) сегодня — own-only, два независимых блока «Мои принтеры»/«Мои
филаменты» (ЛК-лексика, первое лицо). Для `profile.is_master === false` (обычный автор в своём ЛК) —
**ничего не меняется**, эта секция и её копирайт остаются ровно как сегодня.

Для `profile.is_master === true` — новый визуальный режим, видимый own **и** гостю:

### 5.1 Обёртка и заголовок

Секция переименовывается из «Мои принтеры»/«Мои филаменты» в единую **«Парк оборудования»** (сценарий §6.2)
с двумя подписанными подгруппами внутри — не два отдельных `Eyebrow` подряд (это дублировало бы вес
заголовка), а один `Eyebrow` на секцию + лёгкая под-метка группы (тот же токен, что `.ideaRowMeta`, 13px
`--text-dim`, без uppercase-трекинга `Eyebrow`, чтобы не спорить по яркости с секционным заголовком):

```tsx
<div className="ideasSection">
  <Eyebrow>Парк оборудования{!loading ? ` · ${printers.length + filaments.length}` : ""}</Eyebrow>
  {/* §5.3 пустой парк ИЛИ §5.4 два блока */}
</div>
```

### 5.2 Строка техники — новые визуальные детали

`.ideaRow` строки остаются той же анатомией (`profile.catalogs.tsx:145-176`), плюс два добавления из сценария
§6.2:

- **Габариты принтера** (`build_volume`), если заданы — вторым элементом `.ideaRowMeta` через точку-разделитель
  `.ideaRowDot`, тот же паттерн, что «Основной»/«Из каталога» уже используют:
  `430×400×470 мм`. Формат — `${x}×${y}×${z} мм`, без нового компонента.
- **Цветовой сэмпл материала** — сценарий §6.2 просит «тот же чип, что рисует `MaterialPicker`», но
  интерактивный `Chip` (`ui.tsx:451`) семантически неверен для read-only строки (несёт `pressable`/`aria-pressed`
  — обещание нажимаемости, которого здесь нет). Вместо него — статичный цветовой сэмпл 8px кружком перед
  `color_name`, тот же принцип «цвет=информация, не контрол», что уже держит палитра дизайн-системы:

  ```css
  .parkColorSwatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--swatch, var(--border));
    margin-right: 4px;
    flex-shrink: 0;
  }
  ```

  `style={{ "--swatch": filament.color_hex ?? undefined }}` — если `color_hex` не задан, откатывается на
  `var(--border)` (нейтральная точка, не пустое место). Рендерится только если `color_name` присутствует
  (сегодняшнее поведение `filament.color_name ? … : null`, `profile.catalogs.tsx:221-226`, не меняется — просто
  добавляется сэмпл перед текстом).

### 5.3 Владелец vs гость — интерактивность строки

- **own** (`profile.tsx` сегодня уже это гарантирует) — без изменений: тап по строке → редактирование
  (`PrinterEditForm`/`FilamentEditForm`), корзина → `overlay.confirm`, кнопка «+ Добавить…» снизу списка.
- **гость** — строка **не** `role="button"`, без `tabIndex`, без `onClick`, без корзины (`IconButton` не
  рендерится). CSS: `.ideaRow` сегодня жёстко задаёт `cursor: pointer` (`profile.css`, свойство ideaRow) —
  для нередактируемой строки это ложный аффорданс. **GAP-CSS** (§7): модификатор `.ideaRow[data-static]`
  сбрасывает курсор:

  ```css
  .ideaRow[data-static] {
    cursor: default;
  }
  ```

  Owner-строка рендерится как сегодня (`div role="button" onClick=…`), guest-строка — `<div className="ideaRow"
  data-static>` без обработчиков.

### 5.4 Пустой парк (сценарий §6.4)

Развилка от сегодняшнего поведения (сегодня каждая из двух подсекций держит свой независимый `EmptyState`
всегда): когда **и** принтеров, **и** материалов нет вообще — **один общий** `EmptyState` на всю секцию, не
два подряд:

```tsx
loading ? (
  <div className="ideaList"><div className="ideaRowSkeleton" /></div>
) : printers.length === 0 && filaments.length === 0 ? (
  <EmptyState
    icon={<PrinterIcon size={20} />}
    title={own ? "Добавьте свой первый принтер" : "У мастера пока нет оборудования"}
    action={own ? <Button variant="secondary" icon={null} onClick={openAddPrinter}>Добавить принтер</Button> : undefined}
  />
) : (
  <>
    {/* подгруппа «Оборудование» — список или свой EmptyState, если только материалы пусты */}
    {/* подгруппа «Материалы» — список или свой EmptyState, если только принтеры пусты */}
  </>
)
```

Как только **хотя бы одна** категория непуста — секции снова независимы (тот же паттерн, что уже держит
сегодняшний код: подгруппа с нулём показывает свой локальный `EmptyState` без action-кнопки гостю / с
action-кнопкой владельцу, подгруппа с данными — список). Подписи подгрупп — плоский текст 13px `--text-dim`
«Оборудование» / «Материалы» (не второй `Eyebrow`, см. §5.1).

### 5.5 Владелец — точка входа «+ Добавить» (сценарий §6.3)

Не новая механика — существующие `openAddPrinter`/`openAddFilament` (`profile.catalogs.tsx:28-34, 83-96`)
остаются как есть, теперь просто доступны из **той же позиции**, потому что вся секция уже видна на публичной
витрине владельца (не только в приватном ЛК-режиме). Кнопки «Добавить ещё принтер»/«Добавить ещё материал»
(`profile.catalogs.tsx:178-180, 240-242`) — без изменений, видны только `own` (уже так сегодня, т.к. вся секция
раньше была own-only; теперь просто оборачиваются условием `own` внутри, а не условием видимости всей секции).

### 5.6 GAP-DATA — источник данных для гостя

`useActivation()` (`home/activation.ts`) — self-scoped хук («мои принтеры»), читает список текущего
авторизованного пользователя, не произвольного `username`. Публичная витрина требует **чужие** данные
(парк мастера, которого смотрит гость) — GAP-DATA (Back, MF-399): либо `GET /users/:username` возвращает
`printers[]`/`materials[]` в теле профиля, либо новый публичный `GET /users/:username/printers`+`/materials`.
Пока эндпоинта нет — сама верстка (§5.1-5.4) не блокируется, Front подключает `own`-ветку сразу
(`useActivation()` уже есть), guest-ветку — как только Back отдаёт публичный источник.

---

## 6. Матрица владелец vs гость — визуальная сводка (сценарий §8)

| Элемент | own | гость |
|---|---|---|
| Город/слоган (§2) | видит, правит через `AccountEditor` (§2.2) | видит, plain-текст |
| Лого (§2.1) | тот же кроп-флоу, копирайт «Логотип» | видит |
| Соц-хедер `StatTileGrid` (§3) | видит, read-only | видит, read-only |
| Позиция 3: `AccountEditor` **или** ряд кнопок (§4) | `AccountEditor` | `.profileActionRow` (Заказать/Написать/Подписаться) |
| Парк оборудования — список (§5.2-5.3) | `.ideaRow` кликабельна, корзина видна | `.ideaRow[data-static]`, без корзины |
| Парк оборудования — пустое состояние (§5.4) | `EmptyState` + action «Добавить принтер» | `EmptyState`, без action |
| Парк оборудования — добавление (§5.5) | «+ Добавить ещё…» под списком | не видит |

---

## 7. GAP-лист

### GAP-CSS
1. `.profileLocation`/`.profileSlogan` (§2) — новые классы `profile.css`, копия токена `.profileUsername` с
   уменьшением на 0.5-1px и `font-style: italic` у слогана.
2. `.profileActionRow` (§4) — новый флекс-контейнер `profile.css`, стек на `≤480px`.
3. `.parkColorSwatch` (§5.2) — новый 8px цветовой сэмпл, замена интерактивного `Chip` для read-only строки
   материала.
4. `.ideaRow[data-static]` (§5.3) — модификатор сбрасывает `cursor: pointer` для нередактируемой строки парка.

### GAP-DATA (координация с Back/Data, MF-399 — уже зафиксировано `storefront.master.md`, не дублирую детали)
5. `profile.is_master`, `master_profile.{city,slogan}`, `member_since` — новые поля `GET /users/:username`.
6. `ProfilePatch`/`PATCH /me` — принимает `city`/`slogan` (§2.2).
7. Публичный источник парка гостю (§5.6) — `printers[]`/`materials[]` для чужого `username`, не
   self-scoped `useActivation()`.
8. Рейтинг/выполнено (§3) — агрегаты `master_reviews`/`print_requests`, оба блокированы на других карточках
   эпика (MF-992/MF-400) — до их готовности значения приходят `0`/«Отзывов пока нет», верстка не блокируется.

---

## 8. Приёмка (чек-лист)

- [ ] `is_master === false` — `ProfileScreen` пиксель-в-пиксель как сегодня, ни один из блоков §2-§6 не рендерится.
- [ ] Шапка: `.profileLocation`/`.profileSlogan` между `@username` и бейджами, только при заполненных полях;
      лого-кнопка «Загрузить лого» при `is_master`.
- [ ] `AccountEditor`: поля Город/Слоган между «Имя» и «О себе», только при `is_master`, тот же
      тихий-успех/toast-паттерн.
- [ ] Соц-хедер: `.uiStatTileGrid` с 3 `StatTile` вместо `.profileCount`, только при `is_master`, тон
      dim/ok по данным (§3).
- [ ] Ряд кнопок гостю: `.profileActionRow`, порядок Заказать(primary)/Написать(secondary)/Подписаться(secondary),
      «Подписаться» здесь всегда secondary (в отличие от карточки не-мастера).
- [ ] Владелец не видит ряда кнопок на своей странице (там `AccountEditor`, позиция 3 в §1).
- [ ] Парк оборудования: секция «Парк оборудования» видна и own, и гостю при `is_master`; гостю — без
      корзины/тапа (`data-static`), без «+ Добавить…».
- [ ] Пустой парк: один общий `EmptyState`, когда пусты обе категории; независимые под-`EmptyState`, когда
      пуста только одна.
- [ ] Все новые элементы — на существующих примитивах `ui/ui.tsx` (`StatTile`/`EmptyState`/`Button`/`Eyebrow`),
      4 GAP-CSS зафиксированы (§7), ни один не блокирует Front — обходной путь указан в каждом пункте.

---

## 9. Связи

[MF-30](mention://issue/6464e1a4-10cf-4b1c-a019-8f90c8468d96) (эпик) → Фаза 1
[MF-399](mention://issue/1efd18cd-e6bb-4037-b67b-9f253647abdd) (реализация: Back/Data/Front) →
[MF-949](mention://issue/6a824b89-c49a-44fb-9c8a-5aadcdc7b56f) (UX-сценарий) →
[MF-1848](mention://issue/99679471-4ffc-48dd-aac4-a51ff6ae328e) (этот документ, Design). Готово к передаче Front
child-карточкой со ссылкой на этот файл + `storefront.master.md`. Переиспользует: `ui/ui.tsx`,
`profile.catalogs.md`, паттерн заглушки `home/personahome.tsx:40`. Не путать с [park.md](park.md) (приватная
`/park`, другая поверхность — не трогается этой дельтой).
