# AGENTS.md

Памятка для ИИ-агентов/ассистентов, работающих в этом репозитории. Полная версия — **[CLAUDE.md](CLAUDE.md)**, прочитай её первой.

## 🚨 Вся работа ведётся на доске задач

Задачи проекта — на доске **`https://tasks.3mf.tech`** (self-hosted Multica), воркспейс **`3mf`**, префикс **`MF`**. Это отдельная живая доска, не GitVerse Issues.

**Нельзя работать мимо доски:** найди/заведи карточку → держи статус (`todo → in_progress → done`). **Любое поручение оператора = карточка на доске**, а не «тихое» действие.

- Как оперировать доской (API/CLI и демон) — **[docs/process/multica.md](docs/process/multica.md)**.
- Правила доски и оформление карточек — **[docs/process/tasks.multica.md](docs/process/tasks.multica.md)**.
- Проверка подключения: `multica issue list --limit 10`. Вход CLI — `multica login --token <PAT>`.

Остальные правила (нейминг, секреты, процесс, архитектура) — в [CLAUDE.md](CLAUDE.md) и [readme.md](readme.md).

## 🗺 Зоны ответственности и швы (параллельная работа без коллизий)

Перед работой над кодом — прочитай **[docs/architecture/service.map.md](docs/architecture/service.map.md)**
и найди СВОЮ папку в [CODEOWNERS](CODEOWNERS). Три золотых правила:
1. **Одна папка — один владелец.** Не лезь в чужую папку — ходи через шов (контракт) или карту-зависимость.
2. **Импортишь только свою папку + `packages/*`.** Не импорть `src` чужого сервиса/домена (исключение —
   read-only ядро `auth`). Межсервисное — через `packages/contracts/*` (http/device-protocol/jobs/
   printer-driver/db-rows).
3. **Менять шов = один PR в `packages/contracts`** (апрув CTO). Это единственная точка синка; дальше
   обе стороны в своём темпе. Не редактируй `server.ts` наскоком — свой домен через свой `routes.ts`.
