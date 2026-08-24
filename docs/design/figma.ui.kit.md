# Figma UI-kit «3D портал»

Источник дизайнера: [3D портал](https://www.figma.com/design/11ZF5HcAYzz6SmocohbgAp/3D-%D0%BF%D0%BE%D1%80%D1%82%D0%B0%D0%BB?node-id=72-15745).
Файл `11ZF5HcAYzz6SmocohbgAp`, страница `UI-kit` (`71:2`). Срез изучен и перенесён в
общий UI-слой 2026-07-23.

Это не второй визуальный язык и не папка с картинками кнопок. Figma — источник формы,
размеров и матрицы состояний; палитра, типографика, доступность и motion продолжают идти
через канон портала и токены `apps/web/src/theme/tokens.css`.

## Что извлечено

| Семейство | Figma node | Матрица |
|---|---:|---|
| Button | `71:724` | primary / secondary / accent / tertiary / translucent / transparent; default / hover / active / focus / disabled; l / m / s / xs; desktop / mobile; иконки опциональны |
| Icon Button | `71:2245` | те же визуальные свойства, состояния, размеры и брейкпоинты |
| Text Input | `72:2353` | label / hint; default / hover / active / typing / filled / error / non-active; desktop / mobile |
| Big Field | `72:2575` | textarea-вариант с теми же состояниями |
| Combobox | `72:3488` | поиск и раскрытие вариантов; desktop / mobile |
| Select | `72:3744` | default / hover / opened / selected / filled / reopened / error / non-active; single / multi |
| Tab item | `72:15419`, `72:15434` | mobile 46px / desktop 50px |
| Chips | `72:15743`…`72:15763` | выбранный экземпляр `72:15745`: 100×42px, body/m 18px line-height, weight 500, горизонтальные padding 12/16px |

Внешняя библиотека Figma привязывает типографику и отступы алиасами. Из выбранного chip
получены значения: `line-height/body/m = 18`, `weight/medium = 500`,
`padding/l fix = 16`, `padding/m fix = 12`, `Full = 100`.

## Геометрия — не унифицировать радиусы

| Примитив | Видимый размер | Радиус |
|---|---|---|
| Button | l 56 / m 48 / s 42 / xs 36px | полная капсула (`999px`) |
| Icon Button | l 56 / m 48 / s 42 / xs 36px | круг (`50%`) |
| Text Input / Select | desktop 56px / mobile 48px | 16px |
| Tab | desktop 50px / mobile 46px | track и active item — капсулы |
| Chip | выбранный пример 100×42px | полная капсула |

У этих семейств намеренно **нет** единого `control-radius`. В прошлой итерации общий
радиус 12px сделал Button и Chip скруглёнными прямоугольниками, хотя в исходном фрейме
они являются капсулами. Compact-варианты также нельзя визуально раздувать до 48px:
42/36px остаются размером фигуры, а минимальная pointer-зона расширяется прозрачным
hit-area и не меняет раскладку.

## Куда это легло в коде

- `ControlSize = l | m | s | xs` — единый размерный контракт.
- `Button` — Figma-варианты плюс совместимые портал-варианты `ghost` и `danger`;
  иконка опциональна, поэтому primary больше не получает старую стрелку/круг автоматически;
  `iconPosition="start|end"` воспроизводит обе композиции из матрицы.
- `IconButton` — варианты, размеры, disabled и обычные button-атрибуты.
- `Chip` — та же шкала размеров; `s` остаётся видимыми 42px, выбранность задаётся
  рамкой/мягким фоном без автоматически придуманной галочки.
- `SegmentToggle` — Figma-геометрия tab-track + сплошная accent-заливка active pill с
  `accent-contrast` текстом; drag-контракт и нативная `role="tablist"` семантика сохранены.
- `TextField`, `TextareaField`, `SelectField` — label, hint, error и нативная
  accessibility-семантика; Big Field имеет фиксированную Figma-геометрию без браузерного resize.
- `Input` остаётся низкоуровневым совместимым примитивом; `controlSize` меняет геометрию,
  а нативный `size` по-прежнему означает ширину в символах.
- `/kitchen-sink` — живая матрица вариантов и состояний в обеих темах.

## Правила применения

1. Новый экран сначала использует эти примитивы; локальный `.someScreenButton` допустим
   только для раскладки, не для повторного рисования состояний.
2. `m` — безопасный дефолт. `s`/`xs` применяются для chips и вторичных панелей;
   их видимый размер совпадает с Figma, а pointer-target не должен менять геометрию.
3. `primary` на экране один. `accent` — подсветка выбранного/контекстного действия,
   а не второй primary.
4. Hover, focus, error и disabled возникают от настоящего состояния DOM. Не передавать
   декоративный `state="hover"` в продуктовый компонент.
5. Сложный combobox/multiselect требует отдельной поведенческой композиции поверх этой
   оболочки: фильтрация, клавиатурная навигация, `aria-activedescendant`, empty/loading.

## Ограничение выгрузки

У текущего Figma View-seat нет Code Connect и лимитирована массовая MCP-выгрузка. Поэтому
в репозиторий перенесена воспроизводимая матрица и токены, а не временные export-URL или
PNG-копии контролов. При появлении Dev/Full seat следующий проход должен сверить точные
цветовые aliases и компоненты сложного combobox/multiselect; публичный API компонентов
выше менять для этого не нужно.
