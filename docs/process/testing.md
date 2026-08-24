# Тестирование портала живьём (Autofab)

Как агенты (и люди) проверяют 3mf.tech в реальном времени: браузер, API, нагрузка. Все инструменты на прод-VDS, где живут агенты. Соответствующий скилл агентов — `autofab-webtest`.

## Служебная агентская сессия
Гейт портала — JWT-cookie `portal_session` (домен `.3mf.tech`, подпись `JWT_SECRET`). Чтобы агенты видели сайт залогиненными без оператора, заведён служебный юзер `autofab-agent` (строка в `users`, UUID в `~/.autofab-uid`) и долгоживущая cookie `~/.autofab-session` (JWT на год, генератор `/usr/local/lib/autofab/gen-session.js`).

- Протухла (401 на закрытых эндпоинтах) или сменился `JWT_SECRET` → `autofab-session-refresh`.
- Cookie — секрет уровня сессии обычного юзера; в git/карточки/логи не попадает.

## `webcheck` — браузерные «глаза»
```bash
webcheck https://dev.3mf.tech/project           # страница
webcheck https://dev.3mf.tech/ --mobile         # 390×844
webcheck https://dev.3mf.tech/ --click "sel" --full --wait 3000
```
Playwright headless (chromium в `~/.cache/ms-playwright`), автоматически подставляет служебную cookie для `*.3mf.tech`. Артефакты — `~/webcheck-out/<ts>/`: `screen.png`, `text.txt`, `console.txt`, `failed.txt` (запросы ≥400), `meta.json`.

## Dev-лаборатория: инструменты анализа и регрессии

На dev-машине развёрнут набор инструментов для расширенного тестирования и анализа. Все доступны как CLI; скилл агентов — `autofab-devlab`. Интерфейсы ниже сверены с исходниками (`/usr/local/bin/*`, `~/autofab-tools/*.js`) — флагов, которых тут нет, у инструментов нет.

> `loadtest` **молча игнорирует неизвестные аргументы**, а `vmatrix`/`a11y`/`lhaudit` читают только те флаги, что описаны ниже. Придуманный флаг не вызовет ошибку — прогон просто пойдёт с дефолтами, а цифры будут выглядеть правдоподобно. Не изобретай флаги: сверяйся с этой секцией.

### `vmatrix` — визуальная регрессия и адаптив
```bash
vmatrix https://dev.3mf.tech/project --baseline   # первый прогон: сохранить эталон
vmatrix https://dev.3mf.tech/project              # последующие: diff-% против эталона
```
Снимает по три скрина на страницу: mobile 390×844 (UA iPhone 13), tablet 820×1180 (UA iPad gen 7), desktop 1440×900. Ходит под служебной сессией (cookie `portal_session`, домен `.3mf.tech`). Сравнение с эталоном — через `odiff`, печатает процент отличия.

Артефакты: эталон — `~/vmatrix-out/baseline/`, прогон — `~/vmatrix-out/<ts>/` (`<slug>__<device>.png`, при отличии — `<slug>__<device>__diff.png`). Путь печатается последней строкой (`out: …`). Без эталона diff не считается — сначала прогон с `--baseline`.

### `lhaudit` — производительность и доступность (Lighthouse)
```bash
lhaudit https://dev.3mf.tech/project             # mobile-профиль (по умолчанию)
lhaudit https://dev.3mf.tech/project --desktop   # desktop-профиль
```
Lighthouse headless по категориям performance / accessibility / best-practices / seo, под служебной сессией. `--desktop` — единственный флаг; выбрать отдельную метрику нельзя, отчёт всегда полный.

Артефакты: `~/lhaudit-out/<ts>/report.json` и `report.html`.

### `a11y` — доступность (axe)
```bash
a11y https://dev.3mf.tech/project
```
Встраивает axe-core и печатает число violations с разбивкой по severity (critical / serious / moderate / minor) и passes, затем сами нарушения с CSS-селекторами узлов. Аргумент один — URL: уровня WCAG и пост-клик-сценария у инструмента нет (нужен сценарий — скилл `webapp-testing`).

Вывод: **только stdout**, файла отчёта не создаёт — перенаправляй сам (`a11y <url> > report.txt`).

### `loadtest` — нагрузочное тестирование (k6)
```bash
loadtest https://api.3mf.tech/api/health              # дефолт: 20 VU, 20s
loadtest https://api.3mf.tech/api/health --vus 50 --dur 60s
```
k6-прогон, сводка по avg / min / med / p(90) / p(95) / p(99) / max. Флага «целевой RPS» нет — нагрузка задаётся числом виртуальных пользователей (`--vus`); `--dur` принимает k6-длительность строкой (`30s`, `2m`).

Вывод: только stdout (хвост сводки k6), файла не пишет. **Неизвестные флаги проглатываются молча** — `--rps 100` не поднимет нагрузку, ты просто получишь дефолтный прогон.

### `autocannon` — нагрузка на локальный эндпоинт
```bash
autocannon -c 10 -d 10 http://localhost:3000/api/health
autocannon --connections 10 --duration 10 http://localhost:3000/api/health
```
Стандартный npm-autocannon (не наша обёртка), поэтому доступен весь его набор флагов. Лёгкий быстрый прогон по localhost перед полноценным `loadtest` по dev.

### `pyan` — статистический анализ (Python)
```bash
pyan script.py [args...]        # выполнить скрипт
pyan -c "import pandas as pd; print(pd.__version__)"
echo "код" | pyan               # из stdin
pyan                            # REPL
```
Это **интерпретатор**, а не парсер данных: своего формата ввода и флагов вроде `--stat`/`--plot` у него нет — данные читаешь сам (pandas/duckdb). Venv `~/.venvs/analysis`: pandas, numpy, scipy, matplotlib, seaborn, duckdb, psycopg2.

Окружение проброшено: `$DEV_DB` — DSN dev-БД (`portal_dev`), `$UMAMI_DB` — DSN Umami. Графики только headless (`MPLBACKEND=Agg` уже выставлен) — сохраняй в файл: `plt.savefig('~/pyan-out/chart.png')`.

### `umami-q` — запрос аналитики поведения
```bash
umami-q websites                         # список сайтов + их id
umami-q stats <website-id> [дней]        # сводка за N дней (по умолчанию 7)
umami-q top <website-id> [type] [дней]   # топ-25; type: url (по умолчанию), referrer, browser…
umami-q pageviews <website-id> [дней]    # просмотры по дням
```
Подкоманды, не флаги. Начинай с `umami-q websites`, чтобы получить id. Вывод — JSON (`stats`/`pageviews`) или TSV «значение → метрика» (`top`).

### `sandbox-db` — эфемерная БД для тестов
```bash
sandbox-db create sbx_myfeature --from portal_dev   # копия схемы+данных dev-БД
DATABASE_URL="$(sandbox-db dsn sbx_myfeature)" pnpm test
sandbox-db list
sandbox-db psql sbx_myfeature                       # интерактивный psql
sandbox-db drop sbx_myfeature
```
Имя обязано подходить под `^sbx_[a-z0-9_]{1,40}$`. `--from portal_dev` копирует **dev**-БД как есть — это не снимок прода и данные не обезличиваются, но и PII прода там нет. Подкоманды `exec` нет: SQL гоняй через `psql`.

База **не удаляется сама** — за собой прибирай `sandbox-db drop <имя>`, иначе она переживёт задачу.

### Гейт безопасности (MF-1892): `pnpm --filter @portal/api test` отказывает на `portal`/`portal_dev`
`apps/api/src/import/ownership.test.ts` и другие интеграционные тесты пишут реальные строки
(`insert into users …`) через `pool.query`. Если `DATABASE_URL` по ошибке смотрит на общую
dev-БД, эти строки утекают на живой `dev.3mf.tech` (инцидент MF-1892: `ownership-test-<epoch>-…`
в каталоге, `QA Q&A <epoch>` на форуме). `apps/api/vitest.config.ts` → `globalSetup:
src/test/dbSafetyGuard.ts` проверяет `current_database()` перед первым тестом и падает, если
это `portal` или `portal_dev`. Гоняй тесты против CI-эфемерной `portal_test` или локальной
`sandbox-db`, не против общего dev.

## dev-контур: почему туда, и CORS-фикс
Тестировать — на **dev.3mf.tech** (открытый стенд, тот же код что прод, без риска для живых данных). Прод `3mf.tech` за PlagID-гейтом — только health/smoke.

dev-фронт ходит в `api.3mf.tech`. CORS API читает отдельную `CORS_ALLOWED_ORIGINS` (comma-list, только на проде) — включает и прод, и dev (`https://3mf.tech,https://dev.3mf.tech`), иначе dev-фронт не может авторизоваться из браузера. `WEB_APP_URL` в эту переменную больше не подмешивается (MF-636, инцидент MF-633: путаница между redirect-target логина и CORS-списком роняла прод-логин) — детали `docs/infra/readme.md` § «Env-контракт: WEB_APP_URL vs CORS_ALLOWED_ORIGINS».

## Инструменты по типу проверки
- **UI/вёрстка/адаптив** — `webcheck` (+`--mobile`); регрессия на трёх разрешениях — `vmatrix`; глубже — скиллы `webapp-testing`, `e2e-testing-patterns`.
- **Доступность** — `a11y` (быстрый axe-скан) и `lhaudit` (категория accessibility); глубже — скиллы `accessibility-auditor` + `web-design-guidelines`.
- **Производительность страницы** — `lhaudit`.
- **API-контракт** — curl со служебной cookie (раздел в `autofab-webtest`); регресс — тесты рядом с кодом.
- **Нагрузка/конкурентность** — `loadtest` (k6, по dev) или `autocannon` (быстро, по localhost) + скилл `Performance Testing Toolkit`.
- **Анализ данных/метрик** — `pyan` (pandas/duckdb, dev-БД в `$DEV_DB`); поведение пользователей — `umami-q`.
- **Интеграционные тесты с БД** — `sandbox-db` вместо моков.

## Правило
«Собралось» ≠ «работает». Заявляя готовность — прикладывай доказательство (скриншот webcheck, код ответа, вывод прогона).

## Эксплуатация (Ops)
- Playwright: пакет `/usr/lib/node_modules/playwright`, системные библиотеки chromium доустановлены (`libatk`, `libnss3`, … из ubuntu-архива; `playwright install-deps` не проходит — сторонние apt-репы 403 через exit-node, ставить пакеты точечно).
- Служебный юзер/сессия — секция выше; ротация — `autofab-session-refresh`.


## Тест-лаборатория Autofab — инструменты (вынесено из сквад-промпта)
Машина сильная — «на глаз» больше не работаем. Всё это CLI прямо на dev, вывод в `~/`:
- **Визуал/адаптив:** `vmatrix <url> [--baseline]` — скрины mobile/tablet/desktop + diff-% регрессии; `webcheck` — браузер-глаза; `lhaudit <url>` — Lighthouse (perf/a11y/seo 0-100 + LCP/CLS/TBT).
- **Доступность:** `a11y <url>` — axe (WCAG, нарушения по severity).
- **Нагрузка/статистика:** `loadtest <url> [--vus N]` — k6 (RPS, p95/p99); `autocannon`.
- **Стат-анализ/поведение:** `pyan` — python pandas/numpy/scipy/matplotlib/duckdb (dev-БД в `$DEV_DB`, графики в файл); `umami-q` — аналитика поведения (что смотрят/откуда/устройства/события).
- **Песочница:** `sandbox-db create sbx_<имя> [--from portal_dev]` — эфемерная БД для теста миграций/запросов, не трогая боевую.
Правило: заявляешь готовность → приложи в карточку ДОКАЗАТЕЛЬСТВО (скор lhaudit / diff vmatrix / p95 loadtest / скрин), не слова. Детали — по каждому инструменту свой скилл (autofab-visual/lighthouse/a11y/load/data/analytics/sandbox — у тебя назначены нужные под роль), док `docs/process/testing.md`.
