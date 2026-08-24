# ARCHITECTURE

**Не монолит.** Текущий монорепо ниже — не конечная точка, а семя: принципы
нарезки сервисов, границы между ними и то, как зоны команд соответствуют
сервисам, — [services.md](services.md).

## Монорепо

```
apps/
  web/     React 19 + TypeScript — фронтенд, единственная публичная точка UI
  api/     Node.js + TypeScript (Fastify) — BFF/публичный API, бизнес-логика, auth
  mesh/    Python (FastAPI) — STL↔3MF конвертация, обработка/оптимизация геометрии
  giga/    Python (FastAPI) — ИИ-слой: GigaChat, диагностика печати, семантический поиск
  relay/   Node.js + TypeScript (Fastify + WS) — stateful WS-туннель к устройствам
           (MF-794, контур MF-390): другой профиль нагрузки, чем stateless HTTP api
           (постоянные соединения, не запрос-ответ) — критерий выделения сервиса из
           services.md; наружу не публикуется (без своего домена, см. apps/relay/readme.md)
  scout/   Python (FastAPI) — парсер-контур: кандидаты станков/филамента и календарь
           релизов из внешних источников (MF-623), пишет в Postgres (machine_candidates/
           release_events); только `/health` наружу, вся работа — периодический
           worker.py, тот же паттерн внутреннего сервиса, что mesh/giga
packages/
  config/  Общие ESLint/tsconfig для TS-приложений
scripts/   Служебные скрипты (версионирование и т.п.)
```

**Почему полиглот, а не всё на одном языке:** `web`/`api` — Node/TS (соответствует остальному стеку plag.space). `mesh`/`giga` — Python, потому что: (1) обработка геометрии (STL/3MF, оптимизация мешей) — экосистема Python (trimesh/numpy/scipy) сильнее, чем JS; (2) интеграция с GigaChat — официальный SDK `gigachat` и `langchain-gigachat` — Python-first.

## Публичная поверхность

**Только `api` открыт наружу.** `web` обращается только к `api`. `mesh`, `giga` и `scout` — внутренние сервисы, наружу не смотрят (см. `SECURITY.md` § «Сетевые границы»). `api` вызывает их по HTTP внутри приватной сети/докер-сети.

| Сервис | Публичный домен | Роль |
|---|---|---|
| `web` | `3mf.tech` | React-приложение (UI-оболочка); аутентификация-гейт на уровне SPA |
| `api` | `api.3mf.tech` | REST/HTTP API; BFF, бизнес-логика, оркестрация внутренних сервисов |
| `mesh` | — | Внутренний: конвертация STL↔3MF, оптимизация геометрии, рендер GLB/webp-превью |
| `giga` | — | Внутренний: диагностика печати, семантический поиск на GigaChat |
| `relay` | — | Внутренний: stateful WS-туннель к устройствам (контур MF-390); постоянные соединения, не запрос-ответ |
| `scout` | — | Внутренний: парсер-контур MF-623 кандидатов станков/филамента (Spoolman/Printables/каталоги), календарь релизов, systemd-таймеры; пишет в Postgres (`machine_candidates`, `release_events`), только `/health` наружу |

Новостной контур сообщества использует отдельное разделение ролей: локальный
GPU-researcher собирает источники и claims, локальная большая модель оформляет
материал, Grok модерирует качество и предлагает улучшения API, а публикует только
детерминированный host-код. Контракт и границы безопасности —
[feed.news.pipeline.md](feed.news.pipeline.md).

**Авторизация закрывает весь портал** (`docs/issues/002.auth.triple.md`, реализация — `docs/epics/auth.triple.md`): `api` — `preHandler`-гейт, всё закрыто без сессии кроме `/health`+`/auth/*`; `web` — тот же гейт на уровне SPA (`AuthGate`, без сессии рендерится только экран входа). Live: PlagID (Telegram через `auth.plag.space`, отдельный репозиторий `garage/auth`) + email-домен-гейт (`@sberbank.ru`/`@sberdevices.ru`, OTP). GigaID (`id.ru`) — отложен.

## Данные и хранилища

- **PostgreSQL** — основная БД (модели, пользователи, заказы и т.п.). Владелец схемы — `api`. Схема — плоские SQL-миграции **dbmate** (`apps/api/db/migrations/`, `db/schema.sql` — ревьюируемый снапшот), применяются шагом деплоя ДО рестарта `api` (MF-586, `docs/epics/backend.foundation.md` § «Решения CTO / 2»). Старый идемпотентный `SCHEMA_SQL` (`apps/api/src/db/schema.ts`) и его загрузка на старте сервера **удалены** — dbmate единственный писатель `schema_migrations`, новые изменения — только новыми файлами в `db/migrations/`. Фрагментация по смыслу/партиции — [data.fragmentation.md](data.fragmentation.md) (слайсы, P2P-обмен, платформа-верификатор).
- **PostgreSQL job tables** — очередь фоновых задач для `mesh`, `giga` и `search`; конвертация/оптимизация выполняется воркерами и не блокирует HTTP-запросы.
- **S3 (cloud.ru)** — бакеты `3mf` (файлы моделей) и `auth` (авторизационные данные), см. `docs/infra/readme.md`. Локально эмулируются через `minio` в `compose.yaml`.
- **Git (bare-репозитории на VDS)** — источник истины по файлам, README и переносимому `portal.project.yaml` проекта (`docs/epics/project.git.md`, спайк-контракт модуля — `docs/architecture/git.module.md`, формат — [project.manifest.md](project.manifest.md)); Postgres остаётся индексом/операционкой. Derived-артефакты (GLB/webp) — по-прежнему S3. Импорт стороннего Git-репозитория (GitVerse) в этот субстрат — только через quarantine-модель безопасности [git.import.security.md](git.import.security.md) (MF-1966), не прямым `git fetch`.

## Управление устройствами (принтеры, станки)

- **Control-plane коннекторов** (`relay` + `api`) — [printer.server.md](printer.server.md) (коннекторы Moonraker/Bambu/Prusa, двусторонняя связь, архитектура туннеля, уровни поддержки); полная спека инициативы — `docs/epics/printer.support.md`.
- **Телеметрия и диагностика relay** — [telemetry.v1.md](telemetry.v1.md) (нормализованный envelope и порядок кадров), [relay.diagnostics.md](relay.diagnostics.md) (безопасная диагностика и redaction).
- **ADR: телеметрия принтеров** — [adr.printer.telemetry.md](adr.printer.telemetry.md) (протоколы по брендам, поддержка в MVP, компромиссы по Bambu LAN-mode, безопасность локального агента).

## Локальный запуск

```bash
# инфраструктура (postgres/minio)
docker compose up -d

# web + api
pnpm install
pnpm dev

# mesh
cd apps/mesh && uv sync && uv run fastapi dev src/mesh/main.py

# giga
cd apps/giga && uv sync && uv run fastapi dev src/giga/main.py
```

## Окружения

| Окружение | Когда обновляется | Версия |
|---|---|---|
| **Staging** | Автоматически на каждый merge в `main` | Последний `YY.RELEASE.MINOR` |
| **Production** | Вручную, `workflow_dispatch` на `deploy.yaml` | Выбранный тег |

Инфраструктура — VDS `ru-4gb-16018` (доступ только через Tailscale, публичный IP не публикуем — см. `SECURITY.md`) + cloud.ru. Домены — `3mf.tech` (web), `api.3mf.tech` (api). `mesh`/`giga` — без публичного домена.

Разделение staging/production на отдельные машины/сети — **отложено на v2** (пока один VDS обслуживает live-домены; растим инфру, когда появится первый реальный прод-релиз с пользователями).

## mesh: Конвертация, оптимизация и рендер

- **Конвертация форматов** (STL↔3MF, оптимизация геометрии) — `apps/mesh/src/mesh/convert.py`, использует trimesh + numpy.
- **Рендер производных ассетов:** 
  - **GLB** для 3D-вьюера (орбитальный просмотр, три.js) — decimated меш до ~150k граней, ≤5 МБ.
  - **webp-миниатюра** для каталога — offscreen-рендер силуэта на прозрачном фоне, SSAA 2× без GPU (детали в [rendering.md](rendering.md)).
  - Реализация: `apps/mesh/src/mesh/preview.py` (чистый Python-растеризатор с z-буфером, работает headless на VDS).

## Решения по зависимостям (со следами вопросов, которые закрыли)

- **`web` — React 19, не Vue.** Изначально рассматривался Vue 3 ради дизайн-кита Sber Platform V (`@v-uik/*`), но пакеты живут в **приватном npm-registry Sber** (нужен аккаунт с доступом + `.npmrc` с токеном) — доступа нет и не ожидается (решение 2026-07-03). Без него у Vue не осталось причины: React выигрывает по консистентности с остальным plag.space, экосистеме 3D-вьюеров (`react-three-fiber` — стандарт для STL/3MF-превью, зрелее `TresJS`) и личной скорости разработки. Дизайн-систему строим свою (custom), не готовый Sber-кит.
- **`gigachain`** — упомянут пользователем как референс, но **deprecated на PyPI** (сообщение пакета: перейти на `langchain` + `langchain-gigachat`). `apps/giga` использует лёгкий официальный SDK `gigachat` напрямую; `langchain-gigachat` можно добавить позже, если понадобится оркестрация цепочек (RAG, агенты).

## Нейминг

Файлы/папки — lowercase, без `-`/`_`, слова через точку (`release.process.md`, не `release-process.md`). Полный список технических исключений (расширения инструментов, ENV-переменные, Python-модули) — `CONTRIBUTING.md` § «Нейминг».
