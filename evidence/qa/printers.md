# MF-1649 — black-box матрица каталога принтеров

Дата проверки: 16.07.2026 18:30 MSK, база проверки `f1ef191d1fe7a3a162d4418ccdf4096a0b96f343` (`origin/dev`).

Локальный прогон: `pnpm --filter @portal/web exec playwright test --config=../../tests/e2e/catalogs/printers/playwright.config.ts --workers=2` — 7 passed, 1 skipped из 8. Тест пагинации помечен `test.fail`: это ожидаемая фиксация доказанного gap, а не зелёный happy-path. `pnpm --filter @portal/web build` — exit 0.

Live-проверка: страницы `dev.3mf.tech` отвечают `HTTP 200`; каталог, комбинация `q=K1 Max&kind=fdm` и unknown detail отрисовываются ожидаемо. Для `/printers` и поискового URL webcheck зафиксировал отдельный `400 POST /feed/events` (телеметрия, не запрос каталога); unknown detail прошёл без сетевых ошибок. Артефакты `webcheck`: `/home/plag/webcheck-out/1784215747437` (`/printers`), `/home/plag/webcheck-out/1784215747733` (`/printers?q=K1%20Max&kind=fdm`), `/home/plag/webcheck-out/1784215747502` (`/printers/does-not-exist`).

| Кейс | Ожидаемо | Фактически | URL / evidence |
| --- | --- | --- | --- |
| Query по бренду/модели | выдача сужается, `q` сохраняется | PASS: `K1 Max` оставляет `Creality K1 Max`, URL содержит `q=K1+Max` | `/printers?q=K1%20Max`; локальный e2e |
| Технология | FDM исключает resin-модели | PASS: `FDM` сохраняет K1 Max и убирает Saturn 4 Ultra; `kind=fdm` | `/printers?q=K1%20Max&kind=fdm`; локальный e2e |
| Объём детали | `≥300³` оставляет подходящие столы и пишет три координаты | PASS: остаются K1 Max, `fit_x=300&fit_y=300&fit_z=300`; X1 Carbon исключён | `/printers?fit_x=300&fit_y=300&fit_z=300`; локальный e2e |
| Мультиматериал | AMS-фильтр оставляет AMS-модели | PASS: X1 Carbon и K2 Plus видимы, K1 Max скрыт, `cap=ams` | `/printers?cap=ams`; локальный e2e |
| Поиск + фильтр | обе группы применяются одновременно | PASS: `q=K1 Max` + `kind=fdm` сохраняются вместе, результат один | `/printers?q=K1%20Max&kind=fdm`; локальный e2e |
| Сортировка | порядок карточек меняется и сохраняется | PASS: `Дешевле` ставит Saturn 4 Ultra первым, `sort=cheaper` | `/printers?sort=cheaper`; локальный e2e |
| Пагинация | при выдаче больше страницы доступна следующая страница | GAP: control `Показать ещё` отсутствует; экран отдаёт все 10 локальных записей без cursor/API | `/printers`; `test.fail` в e2e |
| Клик из листинга | плитка ведёт в канонический detail URL | PASS: K1 Max → `/printers/creality.k1-max` | `/printers/creality.k1-max`; локальный e2e |
| Прямой detail | известный slug открывает полноценную карточку | PASS: K1 Max и объявленный Vulcan One открываются, анонс даёт CTA уведомления | `/printers/creality.k1-max`, `/printers/vulcan.one`; локальный e2e |
| Unknown id / 404 | неизвестный slug даёт честное 404-состояние и ссылку назад | PASS: «Такого принтера у нас пока нет» + «К каталогу» | `/printers/does-not-exist`; локальный e2e и live artifact `1784139901894` |
| Empty | пустой результат объясняет причину и предлагает recovery | PASS: заголовок empty + «Снять “Поиск”», `q` сохраняется | `/printers?q=zzzz-no-such-printer`; локальный e2e |
| Loading | во время загрузки виден skeleton | НЕ ПОДТВЕРЖДЕНО: fixture разрешается сразу, стабильное окно loading недоступно в black-box | `/printers`; причина — локальная `listPrintersFixture()` |
| Error | ошибка источника показывает «Каталог не отвечает. Обновить» | НЕ ПОДТВЕРЖДЕНО: экран не вызывает публичный `GET /printers`, сетевую ошибку нельзя воспроизвести через UI | `/printers`; причина — локальная `listPrintersFixture()` |

## Вывод

Основной пользовательский контур каталога и detail проходит. Пагинация, а также сетевые loading/error-состояния не принимаются как доказанные: текущая реализация обходит публичный API локальной фикстурой. Доказанный дефект передан владельцу Fullstack отдельной карточкой MF-1650; продуктовый код в MF-1649 не менялся.

Commit/evidence: проверенная база `origin/dev` — `f1ef191d1fe7a3a162d4418ccdf4096a0b96f343`; evidence обновляется с ключом MF-1649. E2E и evidence находятся в разрешённом контуре `tests/e2e/catalogs/printers/**` и `evidence/qa/printers.md`. Live baseline `dev.3mf.tech` проверен webcheck: HTTP 200, UI-контракты подтверждены; отдельный `400 POST /feed/events` отмечен выше как телеметрический дефект. Продуктовый web-код не менялся, поэтому отдельный визуальный deploy-effect не ожидается.

## Повторная проверка

16.07.2026 выполнена свежая проверка на актуальном `origin/dev` (`f1ef191d1fe7a3a162d4418ccdf4096a0b96f343`): локальный Playwright — `7 passed, 1 skipped` из 8; web build — exit 0. Live `webcheck` подтвердил `HTTP 200` и UI-контракты каталога/detail; в листинге дополнительно зафиксирован `400 POST /feed/events`, не относящийся к запросам `/printers` и передаче фильтров.

Web build прошёл. Полный `pnpm --filter @portal/web test` выявил отдельный детерминированный сбой `src/home/homedpadnav.test.tsx` (состояние dpad между тестами), не относящийся к MF-1649 и не затрагивающий каталог принтеров; продуктовый код и тесты вне разрешённого контура не изменялись.
