# CHANGELOG

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/). Версии — см. `docs/process/versioning.md`.

## [Unreleased]

### Added
- **(api,giga)** MF-2068 контракт ассистента для главной — prompt-variants и concepts-очередь
- **(giga)** MF-2067 self-hosted Z-Image-Turbo для референс-картинок trellis
- **(web)** adopt Figma UI-kit foundations
- **(scout)** MF-2064 enrich editorial news
- **(contracts)** separate feed news v2 roles (MF-2060)
- **(contracts)** define feed news v1 contracts (MF-2054)
- **(web)** собрать единый поиск и Giga workspace (MF-2043)
- **(devices)** связать device event с приватным incident thread (MF-2047)
- **(giga)** server-owned assistant skill registry + bounded tool-call orchestration (MF-2046)
- **(printers)** каталог /printers переключён с фикстуры на реальный GET /printers
- **(community)** полноценная шапка бренда — логотип, «Экосистема», связанные сабы
- **(catalog)** реальная реализация «ленивого создания» каталожных сабов (MF-2039)
- **(web)** mermaid diagrams in feed posts via native ```mermaid fences
- **(web)** "sources" rich-embed block — favicon+domain chips instead of bare links
- **(api)** dual auth on POST /feed/media — agent_content key can upload post images (MF-2031)
- **(api)** agent accounts foundation — content_agents, agent_content key scope (MF-2029/2030)
- **(search)** собрать ModelContentProvider + bootstrap-entrypoint (MF-2022) (MF-2021)
- **(giga)** переключить kzd/hueforge/trellis на OpenRouter вместо GigaChat (MF-2023)
- **(giga)** подключить ветку генерации trellis через ComfyUI/TRELLIS.2 (MF-2001)
- **(api)** приватные assistant threads/messages/runs API (MF-1997)
- **(api)** versioned индекс нейропоиска моделей для параллельного 1024/2048 rollout (MF-2003)
- **(giga)** RAG и clarification runner для assistant-чатов (MF-2000) (MF-1998, MF-1999)
- **(mesh)** подключить реальный Ed25519 signer/verifier slice-trust.v1 (MF-1992)
- **(mesh)** подключить OrcaSlicer v2.4.2 + U1 profile bundle к dev slice-worker (MF-1988)
- **(mesh)** подключить Orca/U1 мульти-инстанс плиту к очереди слайсинга (MF-1987) (MF-1986)
- **(mesh)** реальный Orca-профиль и headless-слайс Snapmaker U1 (MF-1974)
- **(web)** связать сборку SO-101 со слайсером (MF-1053)
- **(web)** добавить редактор состава проекта (MF-1970)
- **(api)** build session — пиннинг на commit+configuration digest и read-кэш BOM/сцен/DAG (MF-1968) (MF-1963)
- **(contracts)** зафиксировать project-code.v1 и project-import.v1 (MF-1964)
- **(api,contracts)** манифест project-as-code portal.project.yaml v1 (MF-1967)
- **(web)** собрать showcase многокомпонентного проекта (MF-480)
- **(api,web)** разделить оценку Make на печатаемость/геометрию/поверхность (MF-1962)
- **(web)** превратить проект в сценарий изготовления (MF-1794)
- **(api,web)** фасеты каталога проектов — craft/source_format/manufacturing_method/AMS/compatibility=mine (MF-1961)
- **(web)** превратить каталог в проекты-сборки (MF-508)
- **(api)** dev-фикстуры GET /me/printers/:id/live под autofab-agent (MF-1952) (MF-1101, MF-1246)
- **(api)** завести сущность мастера — is_master/master_profile, RBAC, CRUD (MF-399)
- **(web)** расширить ленту и discovery-рельс (MF-971)
- **(header)** сгладить переходы и направить взгляд
- **(header)** сбалансировать навигацию и меню профиля
- **(profile)** витрина и статистика автора MF-1947 MF-1948
- **(MF-1942)** best-effort отправка слайсер-профиля на принтер через MF-26 (MF-1942, MF-958)
- **(web)** заменить фото пользователей персонажами MF-446
- **(slicer-profiles)** обучающий сигнал v2 — калибровки printer×filament и исход печати (MF-1940)
- **(feed)** ACL, vendor-иерархия подписки и scoped AI ingestion для official-сабов (MF-1926)
- **(feed)** обновить detail и composer MF-1935
- **(api)** цена модели в API + гейт скачивания платных моделей (MF-1934) (MF-363, MF-364, MF-365, MF-1026)
- **(feed)** make maker feed content-first (MF-1922)
- **(web,api)** веб-слайсер — редактор стола, слайсинг-джоба, ручной пикер профиля (MF-1094) (MF-1078)
- **(api)** доверие: репутация вкладчика (trusted uploader, ось 3 доверия, MF-1066) — принятый сигнал `print-result` для модели из каталога кредитует/дебетует репутацию её владельца (`user_uploader_reputation`, зеркалит device-репутацию MF-1065); бейдж `owner.trusted_uploader` на `GET /models/:id`.
- **(scout)** агент-парсер OrcaSlicer process/filament → unified slicer-profile схема (`slicer_profiles`/`slicer_profile_candidates`): дельты наследования через `inherits_id`, идемпотентный upsert, провенанс `source/license`. Прогнан на dev на 16 крупных вендорах — 7788 канонических профилей (2086 process + 5702 filament), 239×PLA/130×PETG/68×ABS. Разблокирует движок подбора MF-412 (MF-411 шаг 2, эпик MF-34).
- **(api)** отзыв device-агент-кредов — на устройство, не на парк: `agents.revoked_at` метит один agent-ряд, relay session/open отклоняет отозванный credential на реконнекте, `POST /me/devices/:id/revoke` owner-only с аудитом (MF-887).
- **(api)** публичный API управления принтером v0 — `api_keys` (Bearer, scopes read/control) + `/v0/printers*` (state/telemetry/read/basic-command) поверх device_state/device_telemetry; доставка команд на устройство queued до push-канала relay→агент (MF-888). Дока — `docs/api.public.md`.
- **(design)** визуал морды принтера + бейджи support_level (MF-891).
- **(web)** морда принтера — 7 сцен по спеке MF-891 §2 на моках (`apps/web/src/printerface`, скрытый роут `/face`): простой/печать/пауза/алерт/выбор файла/enroll/настройки, закреплённая шапка-капсула, офлайн-честность, разворот-контраст hero-панель прогресса; enroll-код вынесен в общий `park/enrollcodepanel.tsx` и переиспользован мастером привязки и мордой (MF-926).
- **(web)** гость читает `/`, `/project`, `/project/:id`, `/feed` без входа (`AuthGate` снят с публичных роутов, `user: SessionUser | null`) — тап по скачать/сгенерировать/голос/коммент/форк открывает overlay-промпт входа и доигрывает действие само после логина (`auth/guestintent.ts`/`guestlogin.tsx`/`guestresume.tsx`), MF-850/MF-912.

### Fixed
- **(deploy)** учитывать version.json в web-контуре (MF-2065)
- **(web)** заполнять обложкой превью проекта
- **(web)** показывать опубликованные проекты на главной
- **(web)** match Figma control states
- **(web)** align primitives with Figma geometry
- **(community)** страница саба показывает посты официального бренда, не редиректит мимо
- **(feed)** карточка поста — автор доминантный, саб/категория вторичные
- **(feed)** официальные vendor/machine сабы не гейтятся, лента саба разворачивает иерархию (MF-2037) (MF-1859)
- **(feed)** не показывать сырой portal:embed HTML-комментарий в свёрнутом превью поста
- **(web)** media_kind now controls img vs video rendering in feed posts (MF-2035)
- **(api)** defer printer_reports.agent_ids — table missing on dev despite migration record (MF-2034, MF-2030)
- **(api)** type the agentContentApiKey test fixture as agent_id: string | null
- **(api)** make POST /generations/:id/catalog-draft idempotent (MF-2026)
- **(giga)** reject non-finite layer_height_mm in hueforge (nan/inf)
- **(web)** fall back to artifact_url for non-watertight trellis previews
- **(giga)** wrap hueforge params validation gaps in clean GenerationError
- **(giga)** fall back to next free OpenRouter model when one is rate-limited
- **(giga)** switch openscad branch text-generation from GigaChat to OpenRouter
- **(api)** stop dropping offer_id in generation_offer API responses
- **(deploy)** put ~/.local/bin on PATH for dev autodeploy (giga/uv)
- **(giga)** stamp offer_id onto persisted generation_offer results
- **(api)** безопасный retry failed cloud slice job (MF-1995)
- **(api)** разрешить cloud slice опубликованного чужого проекта (MF-1993)
- **(api)** пересобрать db/schema.sql под переименованную миграцию (MF-1965)
- **(api)** согласовать git-субстрат моделей с epic project.git.md (MF-1965) (MF-514)
- **(web)** расширить каталоги и стабилизировать маскота
- **(header)** закрепить капсулу и фон между маршрутами
- **(MF-1944)** portal.giga-http.service читает dev-БД, не пустой прод (MF-1944)
- **(mesh)** compatible_printers linkage in build_orca_bundle (MF-1919) (MF-1918)
- **(web)** двойной текст в нав-меню при переходе + жирность инпутов/тегов MF-1910 (MF-1909)
- **(web)** обводка вместо заливки у сегмент-тумблера + drag-переключение MF-1908 (MF-919)

## [26.2.1] — 2026-07-03

Релиз №2. Свёрнута непрерывная работа на staging (миноры 26.1.4–26.1.25): авторизация доведена до live, поднят рантайм на VDS с TLS, добавлена доска задач и визуальный стиль.

### Added
- **Авторизация live на `https://3mf.tech`** — Фаза 1 (PlagID/Telegram через `auth.plag.space`) и Фаза 2 (email-домен-гейт `@sberbank.ru`/`@sberdevices.ru` + OTP). Модель `users`/`user_identities`/`email_otp`, сырые claims — AES-256-GCM в S3-бакете `auth`. Спека — `docs/epics/auth.triple.md`.
- **Рантайм на VDS** — Node 22 + PostgreSQL 16 + nginx + systemd (`portal.api.service`) + UFW; `apps/web` статикой, `apps/api` reverse-proxy.
- **TLS** — Let's Encrypt (`certbot --nginx`) на `3mf.tech`/`api.3mf.tech`, автопродление.
- **Доска задач Multica** — self-hosted на `tasks.3mf.tech`, вход через PlagID-гейт; правила — `docs/process/tasks.multica.md`.
- **`design/`** — разбор визуального стиля (тёмная тил/изумруд тема по референсу «Киоск 3D-печати», тач/киоск-паттерны): `readme.md` главный + мелкие тематические файлы.

### Changed
- Экран входа доведён по референсу: единое поле email + выбор домена, PlagID/GigaID карточками, аврора-фон, тумблер тем солнце/луна, брендовый бейдж «Портал». Адаптив под мобильный/планшет/сенсор.
- `issues/008`/`009` закрыты (рантайм и TLS живут; NS-перенос не понадобился).

### Notes
- GigaID (`id.ru`) — Фаза 3, подтверждён реальным, отложен как недоступный.
- Отправка email (OTP) пока не подключена — нет провайдера (`issues/002`).

## [26.1.3] — 2026-07-03

### Changed
- Дефолтная ветка на gitverse.ru переключена `master` → `main` (совпадает с CI-триггерами).
- Затёрты чувствительные данные из доков: email → `@plag`-упоминания, публичный IP VDS → только Tailscale-имя.
- `CONTRIBUTING.md`/`docs/infra/readme.md` — честный статус ручных шагов (защита ветки, self-hosted раннер) вместо преждевременных «сделано».

### Added
- `pip-audit` реально подключён в CI (`apps/mesh`, `apps/giga`) — раньше был только в документации.
- Идеи из демо-прототипа 3dmake в `docs/product/features.md` (fleet-менеджмент принтеров, контроль филамента фермы).

## [26.1.2] — 2026-07-03

### Changed
- `apps/web`: Vue 3 → React 19 (доступа к приватному npm-registry `@v-uik` нет и не ожидается).

## [26.1.1] — 2026-07-03

### Added
- Монорепо-скелет: `apps/web` (React 19 + TS), `apps/api` (Fastify + TS), `apps/mesh` (FastAPI + trimesh), `apps/giga` (FastAPI + GigaChat SDK).
- pnpm workspaces + Turborepo, общий `packages/config` (ESLint/tsconfig).
- CI/CD на GitVerse Actions: lint/test/build по путям, релизный процесс, деплой на self-hosted раннере.
- Схема версионирования `YY.RELEASE.MINOR` + `scripts/version.mjs`.
- Процессные доки: `CONTRIBUTING.md`, `docs/architecture/readme.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE.md`.
- Продуктовые доки: `readme.md`, `docs/product/vision.md`, `docs/product/market.md`, `docs/product/features.md`, `docs/product/brand.md`, `docs/infra/readme.md`.
