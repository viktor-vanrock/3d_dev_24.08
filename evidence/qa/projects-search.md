# MF-1647 — функциональная матрица проектов и поисковой выдачи

Дата проверки: 2026-07-15 (MSK)

Контур: `https://dev.3mf.tech` и воспроизводимый browser-контракт Playwright с API-фикстурой.
Изменён только тестовый контур: `tests/e2e/catalogs/projects/**`; продуктовый код не менялся.

## Вердикт

**PASSED** — все 5 E2E-сценариев проходят; live `/market`, `/project` и поисковый deep-link отвечают HTTP 200. Прямой неизвестный detail возвращает штатный экран «Проект не найден» при ожидаемом API 404.

## Матрица expected / actual

| Кейс | URL | Expected | Actual |
|---|---|---|---|
| Листинг | `/market` | Страница проектов, поле поиска, теги, сортировка и результаты | Playwright: каталог отрисован, поле `Найти проект`, теги/сортировка и 2 результата доступны. Live: HTTP 200, каталог отрисован, failed requests нет. |
| Релевантный поиск | `/market?q=органайзер` | `q` сохраняется в URL, выдача содержит релевантный проект | Playwright: URL сохранил `q=органайзер`, отображён `Органайзер по запросу`. |
| Фильтр и комбинация | `/market?q=органайзер&tag=функциональный&sort=popular` | `q`, `tag`, `sort` совместно передаются в запрос и сохраняются в URL | Playwright: отображён `Комбинированный органайзер`; запрос содержит `q=органайзер`, `tag=функциональный`, `sort=popular`; query-state сохранён. Live `/market?q=organizer&tag=functional`: HTTP 200 и честный EmptyState `Ничего не нашлось` для текущих dev-данных. |
| Пагинация | `/market` → «Показать ещё» | Следующая страница передаёт opaque cursor и добавляет результаты | Playwright: передан `cursor=cursor-page-2`, добавлен результат `Страница 2 — коробка для мастерской`, кнопка исчезла. |
| Переход из результата | `/market` → `/project/project-organizer-1` | Клик по плитке открывает detail | Playwright: URL стал `/project/project-organizer-1`, заголовок detail и пустое обсуждение отображены; запрошены comments/tree/history. |
| Прямой неизвестный detail | `/project/project-does-not-exist` | Неизвестный id не возвращает каталог или пустой экран, показывает 404-state | Playwright и live: shell HTTP 200, экран `Проект не найден`, `В каталог`; live API вернул `404 GET /models/not-a-real-project`, производные tree/history не запрашивались. |
| Empty-state | `/market?q=неттакого` | Пустой ответ показывает EmptyState и сохраняет q | Playwright: `Ничего не нашлось`, подсказка и `q=неттакого` отображены. |
| Ошибка ответа | `/market?q=ошибка` | Ошибка API показывает inline error и сохраняет q | Playwright: `Не удалось загрузить каталог. Проверьте связь.`, `q=ошибка` отображён. |
| Back/forward | `/market?q=органайзер` → detail → back/forward | Возврат восстанавливает q+filter и поле; forward возвращает detail | Playwright: после back восстановлены `q=органайзер`, `tag=функциональный`, значение поля и комбинационная выдача; forward вернул detail. |

## Проверки и evidence

- E2E: из `tests/e2e/catalogs/projects` выполнена команда `CI=1 PORTAL_WEB_ROOT=/home/plag/multica_workspaces/eca850ee-b4cf-4f3c-bbe2-021907c044a2/2b9f1f08/workdir/portal.ru/apps/web ../../../../apps/web/node_modules/.bin/playwright test --config=playwright.config.ts market.spec.ts`: **5 passed (19.8s)**.
- Web unit/a11y: `pnpm --filter @portal/web test`: **97 файлов, 708 тестов**, `a11ycheck` зелёный.
- Web build: `pnpm --filter @portal/web build`: успешно.
- Live `/market`: HTTP 200, 0 failed requests; единственное предупреждение — ожидаемый `AudioContext` до пользовательского жеста. Артефакты: `/home/plag/webcheck-out/1784126640904`.
- Live `/project`: HTTP 200, 0 failed requests. Артефакты: `/home/plag/webcheck-out/1784126640877`.
- Live search deep-link: HTTP 200, EmptyState соответствует текущим dev-данным. Артефакты: `/home/plag/webcheck-out/1784126668195`.
- Live unknown detail: HTTP 200 shell + ожидаемый API 404 и штатный 404-state. Артефакты: `/home/plag/webcheck-out/1784126668186`.

## Git и deployment marker

- Тестовый commit: `9cb547e79e0a985b1d40dc545b9c56111a29288` (`test(MF-1647): добавить black-box матрицу проектов`).
- Последний web-affecting commit в dev перед этой тестовой поставкой: `e4ea7e1`; MF-1647 не меняет web runtime, поэтому live-проверка относится к существующему dev deployment.
- После добавления этого evidence commit результат публикуется напрямую в `origin/dev`; удалённые ветки не создаются.
