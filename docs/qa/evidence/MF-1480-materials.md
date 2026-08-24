# MF-1480 — Visual QA каталога материалов

Дата проверки: 2026-07-13 09:40–09:50 MSK

Контур: `https://dev.3mf.tech`

Commit локальной ветки и `origin/dev`: `7e0572c66d6e44e77cc323b8c706ae881612b526`
Собранные dev-ассеты: `index-CT8E3xBU.js`, `index-DzTHBWtb.css`.

## Вердикт

**PASSED** — каталог и detail доступны, основные состояния и переходы работают. Первоначально найденные MF-1547 и MF-1548 исправлены и повторно проверены на live.

## Viewport evidence

- Desktop: 1440×900 — [listing](listing-desktop-1440x900.png), [detail](detail-desktop-1440x900.png).
- Tablet: 820×900 — [listing](listing-tablet-820x900.png).
- Mobile: 390×844 — [filter sheet](filters-mobile-390x844.png), [detail](detail-mobile-390x844.png).

## Проверенные сценарии

- `/materials`: HTTP 200, 24 плитки на первой странице, визуальная сетка 4/3/2 колонки на desktop/tablet/mobile.
- Поиск `q=ABS`: URL синхронизирован, 24 результата.
- Класс `kind=resin`: URL синхронизирован, 0 результатов и честный EmptyState.
- Пагинация: первая страница 24 плитки, «Показать ещё» добавляет ещё 24 и устанавливает `offset=24`.
- Mobile: кнопка «Фильтры» открывает `role=dialog` с теми же полями; «Показать результаты» закрывает sheet и возвращает фокус.
- `/materials/03c3fa64-2594-4f6f-983e-b9220202c618`: identity AZUREFILM / ABS, 6 вариантов с раскрытием, пустые печати отображаются честно.
- `/materials/not-a-uuid`: 404-состояние «Такого материала у нас пока нет» и возврат в каталог.
- После обновления служебной dev-сессии в проверенных сценариях нет сетевых ошибок; единственное console-сообщение — ожидаемое предупреждение `AudioContext` до жеста пользователя.

## Повторная live-проверка после исправлений

- `7226bee` (MF-1547): tablet-шапка помещается в viewport `820×1180`, capsule-контролы доступны; свежий listing/detail smoke на mobile/tablet/desktop без console/network errors.
- `7e0572c` (MF-1548): в новом browser context прямой detail `/materials/03c3fa64-2594-4f6f-983e-b9220202c618?q=ABS` по кнопке «К материалам» возвращает на `https://dev.3mf.tech/materials?q=ABS`, `about:blank` не появляется.
- Перепроверен обычный list → detail → back: query каталога сохраняется.
- Визуальная приёмка блокирующих замечаний больше не содержит; предыдущие два пункта выше оставлены как исторические причины промежуточного `FAILED` до повторной проверки.

## Детали дефектов

### MF-1547 — tablet header clipping

На 820×900 `header.homeTopbar` помещается в viewport, но `.homeTopbarEdge--right/.homeCapsule` имеет `right=894.23` при `innerWidth=820`; документ скрывает overflow (`scrollWidth=820`). На screenshot видны обрезанные часы/дата и правая часть capsule. Основание: `docs/design/header.capsule.md`, `docs/design/layout.md`, acceptance tablet.

### MF-1548 — cold-start back navigation

В свежем browser context открыт `https://dev.3mf.tech/materials/03c3fa64-2594-4f6f-983e-b9220202c618?q=ABS`. После нажатия `← К материалам`: `history.length=2`, итоговый URL `about:blank`. Внутри обычного перехода list→detail→back query сохраняется, но прямой вход на detail не имеет fallback в каталог. Основание: `docs/design/materials.catalog.md` §4 и `docs/design/material.face.md` «Единый адрес».
