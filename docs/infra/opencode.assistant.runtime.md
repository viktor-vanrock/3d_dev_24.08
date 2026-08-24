# Изолированный OpenCode runtime для assistant-тредов (MF-2045)

Владелец: Ops. Живёт под `deploy/opencode.runtime.*` + `deploy/portal.opencode-runtime.*`.
Не путать с раннтаймом `ocsearch` на хосте `worker`
([hyperpc.local.llm.md](../process/hyperpc.local.llm.md) § «Как это подключено к
флоту») — тот отдельным Linux-юзером обслуживает поисковых агентов флота Multica;
этот образ — под продуктовый assistant (apps/giga → apps/api → web,
[search.assistant.workspace.md](../design/search.assistant.workspace.md)), изоляция
контейнером на `dev-3mf`.

## Что подтверждено (факт, не план)

- **Движок** — [opencode-ai](https://opencode.ai) (репозиторий `github.com/anomalyco/opencode`,
  исторически `sst/opencode`), **MIT-лицензия**, активно развивается (релиз
  `v1.18.4` — 2026-07-20, за день до написания этого документа). Пин-версия —
  `deploy/opencode.runtime.version`.
- **Официальный headless server-режим** — команда `opencode serve` поднимает
  HTTP-сервер с OpenAPI-спекой на `/doc`; `OPENCODE_SERVER_PASSWORD` включает
  HTTP basic auth (без него сервер явно предупреждает в лог "unsecured"; в этом
  раннтайме пароль обязателен, см. env-шаблон). Живьём проверено: без auth `/doc`
  → `401`, с `-u opencode:$PASSWORD` → `200`.
- **Bash/edit/write/patch выключены дефолтным конфигом**
  (`deploy/opencode.runtime.config.base.json`: `tools.bash=false` и т.д.,
  `permission.{bash,edit,external_directory,webfetch}=deny`) — движок не может
  ни выполнить shell, ни отредактировать файл, ни выйти за рабочую директорию,
  ни сходить на произвольный URL. Живьём проверено через `GET /config` на
  запущенном контейнере — сервер эхом возвращает именно эти значения, это не
  только то, что лежит в файле, а то, что реально загрузил процесс.
- **Модель НЕ хардкодится.** Слоты HYPERPC — сырой `llama-server`, отдающий
  модель полным Windows-путём в `/v1/models` (путь уже менялся при свопе
  GPU/модели, см. `hyperpc.local.llm.md`). `deploy/opencode.runtime.entrypoint.sh`
  на каждом старте контейнера повторяет discovery, которым уже пользуется
  `apps/giga/src/giga/assistant/hyperpc_client.py::discover_model` — читает
  `/v1/models` и подставляет актуальный id в конфиг провайдера. Если слот
  недоступен на старте — соответствующий провайдер просто не добавляется
  (деградация, не падение контейнера — тот же паттерн, что везде в
  `giga.assistant`/`giga.worker`).
- **0 credentials сторонних провайдеров.** В контейнере нет ни
  `OPENROUTER_API_KEY`, ни `GIGACHAT_CREDENTIALS`, ни какого-либо
  Anthropic/OpenAI ключа — только `HYPERPC_STRUCTURED_URL`/`HYPERPC_FAST_URL`
  (Tailscale-only адрес) в отдельном env-файле `~/portal.opencode-runtime.env`,
  **намеренно не общем** с `~/portal.giga-dev.env` (тот несёт коммерческие
  креды, этому контейнеру они не нужны и не должны быть видны). Тот же
  принцип "0 credentials", что у `ocsearch` — даже с открытым egress с этого
  контейнера нечем звонить платному провайдеру и нечего слить.
- **Работает в контейнере, не на общем хосте**: свой Docker-образ
  (`deploy/opencode.runtime.dockerfile`, non-root юзер `opencode`), без
  bind-mount хостовых каталогов (эфемерная FS, не видит ни `~/portal.ru-dev`,
  ни чужие раны), публикуется только на `127.0.0.1:3104` (см. `ss -ltnp` —
  свободный порт рядом с mesh `3101`/giga-http `3102`/node `3103`) — так же,
  как `portal.giga-http`. Ресурсные лимиты на контейнер — `768m`/`1 CPU`
  (`docker inspect` подтверждает лимиты применены).
- **Обновления — canary → health → swap → rollback**, не голый
  `docker compose up`: `deploy/opencode.runtime.rollout.sh deploy [VERSION]`
  собирает образ, поднимает его отдельным канареечным контейнером на порту
  `3105`, ждёт живой `/doc` (basic auth) до 60с — и только потом переключает
  `portal.opencode-runtime.service` (systemd, `docker compose` под капотом) на
  новую версию, снова проверяя health на проде. Провал канарейки не трогает
  текущий прод. `... rollback` возвращает предыдущую версию из локального
  state-файла без ребилда. Триггерится автоматически из
  `deploy/portal.deploy-dev.sh` (новый surface `opencode-runtime`, диф по
  `deploy/opencode.runtime.*`) — тот же паттерн auto-deploy, что web/api/giga.

## Что это ЕЩЁ НЕ

- **Нет консьюмера.** `apps/giga`/`apps/api` пока не делают ни одного запроса
  к этому раннтайму — оркестратор и реестр skills (MF-2046, `apps/giga` +
  `apps/search`) ещё не начаты (карточка `todo` на момент написания). Это
  ожидаемо: MF-2045 — субстрат, MF-2046 подключает к нему orchestrator/RAG.
  Продуктовые tool'ы (поиск каталога, генерация 3D и т.д.) будут не
  встроенными инструментами OpenCode (bash/edit и так выключены), а
  MCP-инструментами, которые зарегистрирует MF-2046 — их per-run
  workspace/allowlist/budget — уже его ответственность, не этого документа.
- **Единственный процесс на все треды.** Сейчас поднят один долгоживущий
  контейнер/сервер на порт `3104` — полноценная изоляция «ран = свой
  workspace, свои файлы, чужой тред недостижим» потребует либо per-run
  session-scoping на уровне будущего gateway (MF-2044), либо per-run
  эфемерных контейнеров поверх этого образа — архитектурное решение
  оркестратора (MF-2046), не Ops-инфраструктуры.
- **Egress НЕ ограничен файрволом.** Контейнер физически может обратиться в
  интернет (проверено: `docker run curlimages/curl` внутри дефолтного
  bridge успешно тянет образ с Docker Hub) — сдерживающий фактор сейчас
  ТОЛЬКО отсутствие credentials (см. выше), не сетевой allowlist.
  Iptables/`DOCKER-USER`-правило, сужающее egress до `100.74.48.83`
  (Tailscale), технически возможно (на хосте уже есть прецедент —
  `docs/infra/readme.md` § MF-855, блок `DOCKER-USER` для входящего
  форвардинга), но меняет цепочку, общую для ВСЕХ контейнеров на хосте
  (`multica-frontend`, umami, тестовые Postgres и т.д.) — blast radius шире
  одного сервиса, поэтому не сделано в этом заходе без сверки с оператором.
  **Открытый пункт, адресат — оператор/Ops при следующем touch.**
- **Sudoers не сужены.** Rollout-скрипт делает `sudo systemctl restart
  portal.opencode-runtime` — на `dev-3mf` это покрыто существующим
  `plag ALL=(ALL) NOPASSWD: ALL`, отдельной строки в
  `deploy/portal.deploy.sudoers` (по образцу `portal.api`) не заводилось —
  наименьшая-привилегия версия правила осталась открытым пунктом, не
  блокирующим текущую поставку.

## Установка на новом хосте

```bash
cp deploy/portal.opencode-runtime.env.example ~/portal.opencode-runtime.env
chmod 600 ~/portal.opencode-runtime.env
# заполнить HYPERPC_STRUCTURED_URL / сгенерировать OPENCODE_SERVER_PASSWORD

sudo cp deploy/portal.opencode-runtime.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable portal.opencode-runtime.service

deploy/opencode.runtime.rollout.sh deploy   # build → canary → health → swap
curl -u "opencode:$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:3104/doc
```

## Живая проверка (2026-07-21, dev-3mf)

```
$ curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3104/doc
401
$ curl -u "opencode:$OPENCODE_SERVER_PASSWORD" -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3104/doc
200
$ curl -u "opencode:$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:3104/config | jq '{tools,permission,providers:(.provider|keys)}'
{
  "tools": {"bash": false, "write": false, "edit": false, "patch": false},
  "permission": {"edit": "deny", "bash": "deny", "external_directory": "deny", "webfetch": "deny"},
  "providers": ["hyperpc-slot1"]
}
$ docker inspect portal-opencode-runtime --format 'health={{.State.Health.Status}}'
health=healthy
```
