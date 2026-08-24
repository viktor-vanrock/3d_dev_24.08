# INFRA

Без секретов — только структура. Ключи/токены хранятся локально на VDS, не в git.

**Документы этого раздела:**
- [readme.md](readme.md) — этот файл: VDS, деплой, сервисы, сеть, облако, домены
- [cicd.md](cicd.md) — runbook CI/CD: карта контура, создание пайплайнов, чек-лист правки, диагностика
- [email.md](email.md) — SMTP, DNS (SPF/DKIM/DMARC), подключение нового сервиса
- [firmware.pilot.md](firmware.pilot.md) — runbook пилота custom-прошивки и канонический статус Fleet для UI
- [slicer.ci.headless.md](slicer.ci.headless.md) — провижининг headless OrcaSlicer/PrusaSlicer/Cura на CI-раннере для валидации экспортёров слайсер-профилей (MF-1918)
- [opencode.assistant.runtime.md](opencode.assistant.runtime.md) — изолированный OpenCode runtime для приватных assistant-тредов Portal: лицензия/server-режим, hardened-конфиг, canary/health/rollback (MF-2045)

## VDS

**Поправка (MF-883, 2026-07-10): актуальный рабочий прод — ДРУГАЯ машина, не та, что описана Tailscale-именем ниже.**
Весь текст этого раздела (инциденты MF-855/MF-774/MF-857, юниты, UFW, exit-node policy routing,
GitVerse-раннер) фактически описывает и **проверен живьём на** хосте Tailscale `dev-3mf`
(IP `82.202.159.148`) — именно там сейчас крутятся `portal.api.service`, `portal.deploy.timer`,
актуальная БД (`portal`, порт `5434`), Multica-рантайм (`multica-frontend` на `127.0.0.1:3100` и
т.д.) и именно туда указывает свежий деплой из `main`. Заголовок ниже (`ru-4gb-16018` /
публичный IP из `~/.ssh/config`) — это **другая, отдельная («осиротевшая») машина**: DNS
`3mf.tech`/`api.3mf.tech` сейчас (пока) указывает на неё, она отдаёт собственный, независимый
билд с реальными пользовательскими данными, которых нет в БД `dev-3mf` — подробности и статус
решения в [MF-883](mention://issue/298afc38-f5e4-4d59-b96a-d6ea2e6e2b7b). Не путать эту машину с
`dev-3mf` при работе с SSH/DNS/декомиссией. Ниже — исторический текст как есть, актуализация по
мере разбора MF-883.

- Tailscale-имя: `ru-4gb-16018` (сеть `yak-mirfak.ts.net`). **Агентский доступ — прямой SSH по публичному IP** (SSH-псевдоним `vds` в `~/.ssh/config` на агентских машинах, ключ `id_ed25519_vds_admin`). Публичный IP — только в `~/.ssh/config` на клиентских машинах и в защищённых конфигах, не в репозитории (см. `SECURITY.md`). Tailscale остаётся для доступа оператора со своих устройств.
- ОС: Ubuntu (noble), пользователь `plag`
- Репозиторий развёрнут в `~/portal.ru`
- **Рантайм (развёрнут, работает):** Node.js 22 LTS + pnpm (corepack), PostgreSQL 16 (роль/база `portal`, **порт `5434`** — `5432` на этом VDS занят Docker-контейнером dev-compose, см. ниже), nginx (reverse proxy + статика), UFW (открыты только 22/80/443 + полный доступ с Tailscale-интерфейса `tailscale0`; остальное снаружи закрыто), Docker CE (под сервис доски задач и dev/test-стеки, см. ниже). SSH: `/etc/ssh/sshd_config.d/hardening.conf` — `PubkeyAuthentication yes`, `PasswordAuthentication no`, `PermitRootLogin prohibit-password`.
- **Инцидент MF-855 (2026-07-10): UFW фактически был выключен.** `ufw status` показывал `inactive` (юнит `ufw.service` в systemd — `enabled`/«active (exited)», но это только означает, что стартовый скрипт отработал успешно при `ENABLED=no` в `/etc/ufw/ufw.conf` — сам файрвол ничего не фильтровал), хотя этот файл документировал его как активный барьер. Снаружи были доступны: все Docker-published dev/test-порты (`5432` `portalru-postgres-1`, `6379` redis, `9000`/`9001` minio, `15432`-`15436`/`15499` тестовые Postgres-контейнеры разных карточек), `netdata` (`19999`), и — важнее — **сам прод `apps/api` напрямую на `3000`** и dev-инстанс на `3200` (оба слушают `0.0.0.0`, см. следующий пункт; это НЕ обходной путь мимо `DATABASE_URL`/авторизации, но обходило nginx/TLS-терминацию). Восстановлено: `ufw default deny incoming` + `allow 22/80/443` + `allow in on tailscale0`, `ufw enable`. **Отдельно закрыт кейс «UFW не видит Docker»** (Docker DNAT в `PREROUTING` отправляет трафик на published-порты в `FORWARD` до того, как его увидит INPUT-цепочка UFW) — в `/etc/ufw/after.rules` добавлен блок `DOCKER-USER`: весь форвардинг с публичного интерфейса (`enp3s0`) — `DROP`, с `tailscale0` — `RETURN` (пропуск). Порт-агностично (не список dports): пока чинил, на VDS сама поднялась ещё одна dev/test-БД на новом порту (`15437`, чужая карточка) — список пришлось бы вести вручную вечно, а порт-агностичный дроп по интерфейсу закрывает и будущие. Правила видны через `iptables -L DOCKER-USER -n -v`. Прод `apps/api`/`apps/mesh`/`portal`-БД (`5434`, нативный, не Docker) под этот блок не попадают — их закрыл уже базовый `default deny incoming`. Пароли: у части dev/test Postgres-контейнеров обнаружены дефолтные (`mf411-pg` — `postgres/postgres`) — ротирован немедленно (простаивал, 0 активных соединений); `back-mf411-test-pg`/`fullstack-mf821-test-pg` тоже на дефолте, но **не тронуты** — под ними живые соединения (чужая активная работа), теперь сетевая экспозиция закрыта UFW/DOCKER-USER, ротация — на владельце карточки при следующем touch. Что осталось вне скоупа: полноценный аудит логов подключений на предмет исторической экспозиции (контейнеры без встроенного access-log) не проводился — если понадобится, отдельной карточкой.
- **Инцидент MF-774 (2026-07-10): прод отсутствовал целиком.** Синтетик-мониторинг поймал `3mf.tech` → 404. Диагностика показала — на VDS не было ни nginx vhost'ов `3mf.tech`/`api.3mf.tech`, ни юнита `portal.api.service`, ни таймера `portal.deploy.timer`, ни нативного PostgreSQL (только dev-стек через `docker compose` в `~/portal.ru-dev`/`compose.yaml`, слушающий `5432` с dev-паролем — не прод). Похоже, что прод на этом хосте никогда фактически не разворачивался, хотя `docs/issues/008.vds.runtime.md` фиксирует более раннее «done». Восстановлено с нуля Ops: `apt install postgresql` (роль/база `portal` на `5434`, `DATABASE_URL` в `~/portal.api.env` обновлён на новый порт), `portal.api.service` создан по образцу `portal.api-dev.service`, nginx vhosts `3mf.tech`+`api.3mf.tech` — по шаблонам `deploy/nginx.3mf.tech.conf`/`nginx.api.dev.3mf.tech.conf` (TLS — существующий сертификат, SAN уже покрывал оба хоста), `portal.deploy.service`/`.timer`/sudoers — установлены по инструкции в шапке юнита. Первый тик таймера сработал штатно (self-heal перевёл `~/portal.ru` с `dev` на `main`, собрал, прогнал все миграции на новую пустую БД, поднял `portal.api`). Проверено live: `https://3mf.tech/` и `https://api.3mf.tech/health` → 200, deep-link SPA-роуты (`/project`) отдают `index.html`. Что осталось не восстановлено (вне скоупа этого инцидента, отдельные карточки при необходимости): `portal.backup.timer`/`portal.disk-monitor.timer`/`portal.mesh-worker`/`portal.scout-*` — не проверялись/не переустанавливались.
- **`apps/api`** — systemd-сервис `portal.api.service`, слушает `3000` на `127.0.0.1` (`apps/api/src/main.ts`, `server.listen({ port, host: "127.0.0.1" })`; dev-инстанс `portal.api-dev.service` аналогично на `3200`) — исправлено [MF-858](mention://issue/44a98ccf-fd64-4c59-b279-6c3d10260894) (до этого биндился на `0.0.0.0`, что до MF-855 означало прямой доступ снаружи в обход nginx/TLS; теперь bind-level barrier есть в дополнение к UFW). Секреты — `EnvironmentFile=~/portal.api.env` (chmod 600, не в git). **`apps/web`** — статическая сборка (`vite build`) в `apps/web/dist`, отдаётся nginx.
- **`apps/mesh`** — воркер конвертации STL→3MF (не смотрит НАРУЖУ — публичного домена нет и не будет, границы см. `docs/architecture/readme.md`), systemd-юнит `portal.mesh-worker.service` (шаблон в репо — `apps/mesh/deploy/portal.mesh-worker.service`, по образцу `portal.api`). Секреты — `EnvironmentFile=~/portal.mesh.env` (chmod 600, не в git): `DATABASE_URL`, `S3_*`, `S3_BUCKET_MODELS=3mf`. С 2026-07-09 указывает на прод-S3 cloud.ru (см. «Прод-cutover» ниже). Установка — комментарий в шапке юнит-файла. **2026-07-10 (MF-842):** `portal.mesh-worker.service` не пережил MF-774-восстановление (см. выше) и не был установлен заново — юнит и `~/portal.mesh.env` восстановлены Ops (env пересобран из тех же кредов `DATABASE_URL`/`S3_*`, что и `~/portal.api.env`, бэкапов `~/portal.mesh.env.enc` на VDS не нашлось — `portal.backup.timer` тоже не переустановлен, см. «Что осталось не восстановлено» выше); `active (running)`.
  - **HTTP-поверхность (`mesh.main:app`, FastAPI) развёрнута** (MF-842, 2026-07-10) — `portal.mesh-http.service`, слушает `127.0.0.1:3101` (**не 3100** — этот порт на VDS уже занят контейнером `multica-frontend`, тот же хост держит и рантайм агентского сквада, см. «Где ты работаешь» в CLAUDE.md сквада), тот же `~/portal.mesh.env`. `curl 127.0.0.1:3101/health` → `{"status":"ok","service":"mesh"}`. **2026-07-17 (MF-1793): `apps/api` теперь вызывает `POST /make-photos`** (`makes/meshClient.ts`, из `POST /makes`) — клиент читает `MESH_HTTP_URL`, дефолт уже `http://127.0.0.1:3101` (совпадает с реальным портом сервиса), доп. настройка `~/portal.api.env` для этого не нужна.
  - **2026-07-11 (MF-989): headless-бинарь слайсера установлен для будущего серверного слайсинга (MF-958).** `apt install prusa-slicer` (2.7.2, репозиторий `noble/universe`) — на `dev-3mf` `/usr/bin/prusa-slicer`, ~600MB зависимостей (GTK/OCCT — GUI-либы тянутся пакетом, но бинарь полностью работает headless: `prusa-slicer -g --export-gcode --load <profile.ini> -o out.gcode in.stl`, проверено живым куб-STL end-to-end). OrcaSlicer не ставился — нет apt-пакета/готового headless CLI для Ubuntu noble, PrusaSlicer покрывает потребность без сборки из исходников. Диск на `dev-3mf` был `89%`/`5.5G` свободно до установки — после `90%`/`4.9G`, запас есть, но небольшой — следующий тяжёлый пакет проверяй `df -h /` заранее.
    **Лимиты CPU/времени/памяти на сам процесс слайсера (не на python-поток — `sandbox.py`/`RLIMIT_AS` тут не подходит, это внешний CLI, а не fork):** `systemd-run --user --scope -p CPUQuota=<N>% -p MemoryMax=<M> -p TasksMax=<T> -- timeout <sec> prusa-slicer ...` — cgroup-лимит на весь процесс слайсера, `timeout` — жёсткий wall-clock backstop поверх cgroup (симметрично тому, как `sandbox.py` держит wall-clock таймаут в родителе, а не полагается только на `RLIMIT_CPU`). Требует рабочей user-шины systemd для `User=plag` — включено `sudo loginctl enable-linger plag` (иначе `systemd-run --user` падает `Failed to connect to bus: No medium found` из system-юнита, у которого нет сессии). `portal.mesh-worker.service`/`portal.mesh-worker-dev.service` получили `Environment=XDG_RUNTIME_DIR=/run/user/1000` + `Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` и `After=...user@1000.service` (юнит-файл в репо — `apps/mesh/deploy/portal.mesh-worker.service`; dev-юнит ad hoc на VDS, обновлён так же) — без них воркер не сможет вызвать `systemd-run --user`. Проверено живьём именно из-под окружения `portal.mesh-worker.service` (`sudo -u plag env XDG_RUNTIME_DIR=... DBUS_SESSION_BUS_ADDRESS=... systemd-run --user --scope ... prusa-slicer ...` → gcode сгенерирован; отдельно проверено, что `CPUQuota`/`timeout` реально режут — зависший процесс убит по wall-clock).
    **Не сделано в этой карточке (зона Mesh, MF-958):** сам python-обёртка/вызов из `apps/mesh` (резолвер профиля → `.ini`-бандл — MF-412 — тоже ещё не готов), запись джобы в БД (`slice_jobs` — MF-988), выбор конкретных `CPUQuota`/`MemoryMax`/`timeout` под прод-нагрузку (числа выше — из smoke-теста на пустом кубе, не тюнинг под реальные модели/VDS-бюджет). Готово только фундаментальное: бинарь установлен, доступен из-под воркера, механизм лимита процесса подтверждён рабочим.
  - **2026-07-10 (MF-857): `portal.mesh-worker.service`/`portal.mesh.env` — это ТОЛЬКО прод** (`DATABASE_URL=.../portal` на `5434`, бакет `3mf`). Dev (`portal_dev` на `5432`, бакет `3mf-dev`) не имел своего воркера — модели, загруженные на `dev.3mf.tech`, физически зависали в `pending` навсегда, независимо от S3-кредов. Добавлен отдельный юнит `portal.mesh-worker-dev.service` (`WorkingDirectory=/home/plag/portal.ru-dev/apps/mesh`, `EnvironmentFile=/home/plag/portal.mesh-dev.env` — `DATABASE_URL` из `~/portal.api-dev.env`, `S3_BUCKET_MODELS=3mf-dev`, те же S3-креды cloud.ru, что и у прод-контура: сервисный аккаунт уже даёт доступ к `3mf`/`3mf-dev`/`auth`/`auth-dev`, отдельный dev-ключ не заводился). Юнит не в репо (ad hoc на VDS, по тому же паттерну, что `portal.api-dev.service`) — `enable --now`, `active (running)`. Заодно заполнены пустые `S3_ACCESS_KEY`/`S3_SECRET_KEY` в `~/portal.api-dev.env` (были пустые — `POST /models` на dev отдавал `storage_not_configured`) и перезапущен `portal.api-dev`. Живой E2E (upload STL → `pending` → воркер → `ready`, canonical 3MF + `download.stl`-дериватив) прошёл на `dev.3mf.tech`.
  - **MF-1248-04 (2026-07-13):** для dev добавлен отдельный `portal.mesh-slice-worker-dev.service` по тому же принципу (`WorkingDirectory=/home/plag/portal.ru-dev/apps/mesh`, `EnvironmentFile=~/portal.mesh-dev.env`, бакет `3mf-dev`). Он обрабатывает `slice_jobs` и пишет результат только под `protected/slices/<account_id>/<slice_key>.gcode`; production unit и `portal.mesh.env` не используются. Bucket policy `3mf-dev` разрешает anonymous `GetObject` только для `public/*`, protected prefix закрыт по умолчанию. На VDS unit установлен и включён отдельно от конверсионного `portal.mesh-worker-dev.service`.
  - **Попутная находка (MF-857): `/srv/git/repos` не существовал на VDS вообще** — блокировало `POST /models` целиком (и на dev, и на прод — путь общий, не per-env), падало на шаге `createProjectRepoAndCommit` с `EACCES`/`ENOENT` (модель откатывалась, `upload_failed` 500). Каталог по спеке `docs/infra/git.repos.md` (`plag:plag`, `750`) не пережил MF-774-восстановление прод-VDS с нуля и с тех пор не создавался повторно. Создан заново (`mkdir -p /srv/git/repos && chown plag:plag ... && chmod 750 ...`) — без этого фикса ни один аплоад модели (prod/dev) физически не мог пройти дальше S3-записи.
- **`apps/giga`** — три юнита, разный DATABASE_URL по назначению. `portal.giga-worker.service`
  (генерации, MF-661) и `portal.giga-http.service` работают с dev-очередью/каталогом через
  `~/portal.giga-dev.env` (`portal_dev`@5432, `generations-dev`): POST/GET `/generations`
  пока живут только в dev, и воркер обязан claim'ить те же строки, которые создаёт API.
  `portal.giga-catalog.service` (агент каталога станков, MF-649) читает `~/portal.giga.env`
  с прод-БД (`portal`@5434). `portal.giga-http.service`
  (HTTP-поверхность `/embed`, `/slicer-profiles/{printer_id}/{filament_id}/ai-delta` и т.п.,
  MF-1015) при этом сам живёт в dev-контуре (`WorkingDirectory=~/portal.ru-dev/apps/giga`, код
  ещё не в `main`) — до 2026-07-18 он тоже читал `~/portal.giga.env`, т.е. dev-код упирался в
  прод-БД, где `slicer_profiles`/`materials` **пустые** (заполнены только в `portal_dev`).
  **MF-1944 (2026-07-18, Ops):** заведён отдельный `~/portal.giga-dev.env`
  (`DATABASE_URL=.../portal_dev@127.0.0.1:5432`, тот же `GIGACHAT_CREDENTIALS`, что и в
  `~/portal.giga.env`) для `portal.giga-http.service` и `portal.giga-worker.service` —
  оба шаблона обновлены в репо и развёрнуты на VDS.
  `-catalog` не тронут, остаётся на проде. Живая проверка: `curl
  127.0.0.1:3102/slicer-profiles/26e7e47b-1d0e-4d18-981b-0ab67e082412/a27d1699-cc33-4ae6-9227-2aaed3c20493/ai-delta`
  → `200` с непустым `base`-профилем (реальный `slicer_profiles`-ряд из `portal_dev`, `ai`-слой
  честно пуст — `GIGACHAT_CREDENTIALS` не задан, это отдельный вопрос, не блокирует каталог).
  **MF-2067 (2026-07-29):** для prompt variants и ветки concepts на оба dev-юнита установлены
  systemd drop-in’ы: `HYPERPC_FAST_URL=http://100.74.48.83:1235`; воркер дополнительно получает
  `COMFYUI_URL` из `~/portal.giga-dev.env` и имена весов Z-Image-Turbo через
  `ZIMAGE_UNET_NAME=z_image_turbo_int8_convrot.safetensors`,
  `ZIMAGE_CLIP_NAME=qwen_3_4b_fp8_mixed.safetensors` и
  `ZIMAGE_VAE_NAME=z_image_vae.safetensors`. Адреса остаются server-only, секретов в
  drop-in’ах нет. Инцидент GPU-хоста закрыт: `1235` (Gemma fast), `1236` (второй LLM-слот),
  `8188` (ComfyUI) и `8189` (embedding/reranker) отвечают с VDS; `portal.giga-http` и
  `portal.giga-worker` активны. Живой E2E: Gemma через публичный API → шесть разных prompt
  variants, Z-Image последовательно сохранил шесть PNG в приватный generations-бакет,
  публичные `/concepts/:id/preview` отдали их на главной, повторный запрос переиспользовал
  те же ready-карточки.
- **Инцидент MF-938 (2026-07-11): dev-compose стек (`portalru-postgres-1`/`redis`/`minio`, `5432`/`6379`/`9000-9001`) периодически терял пароль роли `portal_dev` (`28P01`), валя все DB-эндпоинты `api.dev.3mf.tech` — минимум дважды за одну ночь.** Первые заходы чинили симптом (`ALTER ROLE ... PASSWORD`) — держалось часами, потом повторялось без единого связанного DDL в логах Postgres. Корень нашли по `docker inspect`: сам стек фактически жил не в документированном `~/portal.ru-dev/compose.yaml`, а поднимался (кем-то, когда-то) из **чужого эфемерного `multica repo checkout` task-workdir** — `multica repo checkout` всегда кладёт репозиторий в каталог с именем `portal.ru`, поэтому default Docker Compose project name (по basename каталога) у **любого** агентского чекаута — один и тот же `portalru`, совпадающий с этим живым dev-стеком. Любой агент, который в своей (как ему казалось изолированной) задаче зашёл в такой чекаут и запустил `docker compose up`/`down`/`down -v`, на самом деле управлял ЭТИМ общим стеком — самое правдоподобное объяснение периодических «пересозданий» роли без пароля.
  **Фикс (без даунтайма данных):** стек перенесён под явное имя проекта, привязанное к стабильному, Ops-owned пути. В `~/portal.ru-dev/` (untracked, не в git — `.gitignore` уже закрывал `.env`/`.env.*`) добавлены:
  - `.env` — `COMPOSE_PROJECT_NAME=portalru-dev-shared`;
  - `docker-compose.override.yml` — оба volume (`portal.postgres.data`, `portal.minio.data`) объявлены `external: true` с буквальными именами старых физических томов (`portalru_portal.postgres.data`, `portalru_portal.minio.data`) — миграция без копирования данных, просто смена «владельца»-проекта.

  Выполнено: `docker compose --project-name portalru down` (старые контейнеры остановлены, volumes не тронуты) → `docker compose up -d` из `~/portal.ru-dev` (новые контейнеры `portalru-dev-shared-{postgres,redis,minio}-1`, те же порты, те же volumes) → рестарт `portal.api-dev`/`portal.mesh-worker-dev`. Проверено: `portal_dev` с паролем, данные (таблицы/S3-бакеты) на месте, `GET /machines` → 200 (12+ запросов подряд, 0 `28P01`), `webcheck https://dev.3mf.tech/lk/materials` → 200, консоль чистая, 0 упавших сетевых запросов.

  **Итог — почему это закрывает дыру:** default-именование (`portalru`, по basename `portal.ru`) у случайного агентского чекаута теперь указывает на **другой, пустой** compose-проект (никаких живых контейнеров под именем `portalru` больше нет) — `docker compose down`/`up` в чужом чекауте отныне создаёт/останавливает только СВОИ изолированные контейнеры/тома, а не общий dev-стек. Порт-конфликт (`5432` уже занят реальным стеком) — дополнительный барьер: рогью `docker compose up` в чужом чекауте с этим же `compose.yaml` упадёт на биндинге порта, а не молча тронет чужие данные.
  **Правило для всех агентов (пока не автоматизировано иначе): НЕ запускайте `docker compose up`/`down` на своём чекауте `portal.ru` для локального тестирования БД — используйте `sandbox-db`** (throwaway Postgres, штатно изолирован per-карточка). Обновить эту доку, если появится техническая защита от самой возможности коллизии (например, если `multica repo checkout` научится класть чекауты в уникальные по имени каталоги).
- **`apps/relay`** — repository target is the independent compiled Nest package
  `@portal/relay`; the deployable entrypoint is `apps/relay/dist/main.js`. Root build/dev
  scripts, `deploy/portal.deploy-dev.sh`, systemd templates, monitoring and the active relay
  proxy template now point to that artifact. Relay talks to the API only through authenticated
  `/internal/relay/v1/*` using `RELAY_API_BASE_URL` + `RELAY_SERVICE_TOKEN`.
  Gateway mTLS/WSS and observability are separate: dev template uses loopback `3011` for the
  gateway TLS listener and `3012` for `GET /health`, `/ready`, `/metrics`. Public nginx is L4
  TLS passthrough to the gateway listener; observability remains loopback-only. See
  `apps/relay/readme.md`, `apps/relay/deploy/portal.relay-dev.service` and
  `deploy/nginx.relay.3mf.tech.conf`.
  Historical MF-930 evidence belongs to the superseded runtime and does not prove the Nest
  artifact. The repository switch in this change does **not** install/restart a unit or move
  dev/prod traffic. Live acceptance requires the compiled artifact, loopback readiness, a real
  mTLS v1 handshake, command/result flow and graceful SIGTERM per
  `docs/infra/relay-qa-readiness.md`. Production remains untouched.
- **`apps/scout`** — парсер-контур внешних источников (кандидаты станков/филамента → `machine_candidates`, MF-623). Два юнита (шаблоны в репо — `apps/scout/deploy/`, по образцу `apps/mesh`): `portal.scout-worker.service` — постоянный воркер, тик раз в час гоняет `vendor_whitelist` (список источников тика не включает slicer_profiles — см. ниже); `portal.scout-slicer-profiles.timer` (+`.service`) — разовый прогон `scout-slicer-profiles-agent` (orca+prusa, MF-627) раз в сутки (04:00), отдельно от воркера, т.к. источник редкий и не стоит дёргать ~800 файлов GitHub каждый час. Секреты — `EnvironmentFile=~/portal.scout.env` (chmod 600, не в git): `DATABASE_URL`, опционально `SCOUT_POLL_INTERVAL_SECONDS`, `GITHUB_TOKEN` (поднимает лимит `api.github.com`). Установка — комментарий в шапке юнит-файлов.
- **`apps/search`** — воркер индексации (`search_index_jobs` → `model_embeddings`, HYPERPC-профиль `hyperpc/qwen3-vl-embedding-2b`), только dev (`apps/search` нет в `main`). **Установлен и запущен (MF-2021, 2026-07-20):** `portal.search-worker.service` (шаблон в репо — `apps/search/deploy/portal.search-worker.service`, по образцу `portal.mesh-worker`/`portal.giga-worker`), `WorkingDirectory=~/portal.ru-dev/apps/search`, `EnvironmentFile=~/portal.search-dev.env` (chmod 600, не в git): `DATABASE_URL` на `portal_dev` (тот же контур, что `~/portal.api-dev.env`), `HYPERPC_URL=http://100.74.48.83:8189` (слот 4, живой `/health` → `{"status":"ok","device":"cuda"}` с этой VDS через Tailscale). `systemctl status` → `active (running)`, не падает, `NRestarts=0`.
  **⚠️ Живая находка при установке — воркер простаивает НАВСЕГДА, даже с валидными кредами (это не проблема установки/env):** `search-worker` из `pyproject.toml` — это буквально `portal_search.worker:run_loop` без аргументов; `run_loop(repo=None, content=None, writer=None)` при `missing_adapters=True` всегда уходит в `_sleep_until_signal()` (`journalctl`: `воркер простаивает: не сконфигурированы  — ждём креды/адаптеры`, пустые плейсхолдеры подтверждают, что дело не в `DATABASE_URL`/`HYPERPC_URL`). В пакете нет ни одного `__main__`/CLI-файла, который бы собрал `PostgresIndexRepository`/`PostgresEmbeddingWriter` (оба класса реально есть в `index_lease.py`) и передал их в `run_loop` — соответствующий `ModelContentProvider`-адаптер для чтения `models`/`model_files` тоже физически отсутствует в коде (сам `apps/search/readme.md` § «Что ЕЩЁ открыто» называет это открытым пунктом Back). **Отдельно, вторая находка:** даже если бы это было собрано, `apps/api/src/models/indexQueue.ts` ставит джобы под активным текстовым профилем `embedding_model='gigachat/Embeddings'` (MF-2013, dim=1024), а этот воркер claim'ит только `'hyperpc/%'` (`profiles.EMBEDDING_MODEL='hyperpc/qwen3-vl-embedding-2b'`, dim=2048, см. `worker.run_once`) — профили не совпадают, ни один текущий продюсер не ставит `hyperpc/%`-джобы (проверено — `search_index_jobs`/`model_embeddings` в `portal_dev` пусты, 0 строк, при 111 моделях). Оба разрыва — код AI/Back, не инфра; демон здоров и не роняет `GET /models?q` (apps/api читает `model_embeddings` напрямую из Postgres, не ходит в apps/search по сети — 0 строк там сейчас безвредны, деградация до lexical-only уже встроена в `list.ts`).
  **Обновление (MF-2022, код в `origin/dev`):** первая находка (нет адаптера/entrypoint) закрыта на стороне кода — `content.py::PostgresModelContentProvider` + `bootstrap.py::main`, `pyproject.toml` `search-worker` теперь указывает на `portal_search.bootstrap:main`. Живая проверка на dev-vm (перекачать код, `uv sync`, `systemctl restart portal.search-worker`, `journalctl` без «ждём креды/адаптеры») не выполнена из этой сессии — нет SSH-доступа к VDS из окружения реализации (`ssh vds` не резолвится, алиас/ключ `id_ed25519_vds_admin` здесь не сконфигурирован). Вторая находка (профиль продюсера `gigachat/Embeddings` vs consumer `hyperpc/%`) закрыта на стороне кода (Back): `indexQueue.ts` теперь ставит джобы под `hyperpc/qwen3-vl-embedding-2b`/dim=2048, тем же identity, что consumer реально claim'ит (`profiles.EMBEDDING_MODEL`) — прямое переключение, не канареечный rollout, GigaChat-креды пусты и в прод, и на dev, защищать нечего (см. `docs/architecture/neural.search.md` § «MF-2022 живая находка»). `list.ts` синхронно переведён на `embedding_2048`/`halfvec(2048)`. Живая проверка (redeploy + первая новая/отредактированная модель реально получает строку `model_embeddings` с этим профилем) не выполнена из этой сессии по той же причине — нет SSH к VDS. Query-side эмбеддинг запроса (`searchEmbedClient.ts`, гибридное ранжирование в `GET /models?q`) всё ещё зовёт GigaChat через `apps/giga` (AI-владение) — dim/пространство эмбеддингов не совпадают с новым write-профилем, `list.ts` это ловит и честно откатывается на lexical (не 500, не молчаливый мусор в ранжировании); включение реального гибрида ждёт HYPERPC-based query-эмбеддера — отдельная карта, не в этом коммите.
- **Деплой `main` — автоматический (polling), MF-479.** Таймер `portal.deploy.timer` раз в минуту гоняет юнит `portal.deploy.service` (`ExecStart=deploy/portal.deploy.sh`): guard (ветка != main → warn + `git checkout -f main`) → `git fetch origin main` → если есть новые коммиты → `git reset --hard origin/main` → `pnpm install --frozen-lockfile && pnpm build` → если в подтянутом диапазоне менялся `apps/api/` — `sudo systemctl restart portal.api` (passwordless sudo только на эту команду, drop-in `/etc/sudoers.d/portal.deploy` — шаблон `deploy/portal.deploy.sudoers`). При ошибке сборки сервис не перезапускается. 3 ошибки подряд → уведомление в telegram-мост + journalctl err. **`~/portal.ru` принадлежит только этому таймеру — агентские ветки/worktree запрещены** (см. `deploy/portal.deploy.rules.md`, MF-545). Шаблоны юнитов/скрипт — в репозитории (`deploy/`), установка на VDS — руками по инструкции в шапке `deploy/portal.deploy.service`. Когда self-hosted раннер (см. «CI/CD-раннер» ниже) заработает — polling можно будет заменить push-триггером.
- **Ручной деплой** (fallback, если таймер остановлен или нужен внеочередной прогон) — тот же путь по SSH: собрать → перезапустить systemd-юнит.

## Доска задач — Multica (`tasks.3mf.tech`)
Отдельный сервис на том же VDS (Docker Compose): self-hosted [Multica](https://github.com/multica-ai/multica) — операционная доска задач под проект. Порты только на loopback (разведены с `portal.api`), снаружи — nginx + TLS. Вход через PlagID-гейт (тот же `auth.plag.space`), допуск по Telegram-ID. Правила использования — `docs/process/tasks.multica.md`; развёртывание/секреты/перенос — не в репо, а на VDS (`~/tasks.multica/MOVING.md`).

## Разработка
- Git-хостинг: [gitverse.ru](https://gitverse.ru/plag/portal.ru)
- Доступ с VDS/машин разработки — personal access token в git credential store (локально на каждой машине, не в репозитории)

## Облако — cloud.ru
Вся инфраструктура (compute, S3) — на cloud.ru. Локализация хранения — РФ (`ru-central-1`), закрывает требование 152-ФЗ по локализации ПДн (см. `SECURITY.md` § «Персональные данные»).

**S3-бакеты** (Evolution Object Storage, endpoint `s3.cloud.ru`, project id
`df4f09aa-c024-4884-991b-4915355efffe`, регион `ru-central-1`). Раскладка v1 — 4 бакета,
ровно по тому, что реально пишет приложение (`apps/api/src/storage/s3.ts`,
`apps/giga/src/giga/storage.py`) — не плодим бакеты, которых app не пишет
(эпик [MF-703](mention://issue/2d8ac51f-393d-41b2-b77a-0b8877bc3bf1), решение CTO, [MF-705](mention://issue/bdc5b314-b292-44f3-b95b-0e9a9aaecab3)):

| Бакет | Политика | Содержимое | Переменная |
|---|---|---|---|
| `3mf` | **смешанная (MF-754, 2026-07-10)** — public-read только под префиксом `public/*`, всё остальное приватно (fail-closed) | модели/проекты/артефакты + пользовательские загрузки (`uploads/` — отдельный бакет не заводим) | `S3_BUCKET_MODELS` |
| `auth` | private | `identities/<user_id>/<provider>.json.enc` (AES-256-GCM, ключ только на VDS) — схема в `docs/epics/auth.triple.md` § «Модель данных» | `S3_BUCKET_AUTH` |
| `generations` | **public-read** | превью/артефакты генерации (Кандинский/GigaChat); прямые URL для превью, offload | `S3_BUCKET_GENERATIONS` |
| `backups` | private | дампы БД + env, восстановимость вне VDS; отдельные ключи/политика | *(вне S3-абстракции приложения, пишет Ops напрямую)* |

Остальные категории (uploads/thumbnails/static/cdn отдельными бакетами) в v1 не заводим — app их
не пишет, отложены до появления реального писателя.

**Бакет №5, вне этой раскладки:** `printers-research` (public-read, медиа карточек принтеров,
`S3_BUCKET_PRINTERS_RESEARCH`) — эпик БД принтеров, не витрина моделей/генераций/auth выше, детали
и провижн — § «Бакет №5 — `printers-research`» ниже.

**Composite Access Key** (грабля): Access Key ID = `<tenant_id>:<key_id>` (не просто `key_id` —
иначе 403), Secret = `<key_secret>`. Подтверждено на практике: `tenant_id` в этом проекте совпадает
с `project_id` выше — отдельного «Tenant ID» из карточки Object Storage искать не нужно. Ключи
выдаёт агент Cloud.ru через консоль cloud.ru → Data Storage → Object Storage; значение секрета не
коммитится, не публикуется в карточки/логи — только `.env` на VDS (`portal.api.env` /
`portal.mesh.env`, chmod 600) через Ops.

**Провижн выполнен (MF-707, 2026-07-09).** Все 4 бакета созданы на cloud.ru (region `ru-central-1`),
политики применены и проверены (`get-bucket-policy`/`get-bucket-lifecycle-configuration` + smoke-тест
GET/LIST):
- `3mf`, `generations` — bucket policy `s3:GetObject` для `Principal: "*"` (анонимный GET по ключу),
  **`s3:ListBucket` не выдан** — листинг бакета закрыт, ровно как в дизайне.
- `auth`, `backups` — без bucket policy, ACL только `FULL_CONTROL` для владельца (private).
- Lifecycle: `generations` — `Expiration: 30 дней` на все объекты (решение CTO по MF-706, комментарий
  в [MF-707](mention://issue/eb239a0a-d5ab-426d-93d6-fdad5ce2770f)). `backups` — та же 30-дневная
  expiration-политика как приближение «ротация 30 поколений» (бэкап ежесуточный, `deploy/portal.backup.sh`
  → 1 генерация/день, так же как локальная ротация 14 дней = 14 поколений). `3mf`, `auth` — lifecycle
  не включён (хранение бессрочно, решение MF-336).
- Ключи доступа (тот же composite key агента Cloud.ru — отдельного сервис-аккаунта для приложения не
  заводили, создание ключей тоже консольная операция) переданы Ops файлом `~/mf707-cloudru-s3-keys.handoff`
  (chmod 600, вне git, на той же VDS) — значения для `portal.api.env`/`portal.mesh.env`.

**✅ Прямой публичный URL включён и проверен (MF-715, 2026-07-09).** Оператор проставил в личном
кабинете cloud.ru **Domain name** для всех 4 бакетов (`3mf`, `generations`, `auth`, `backups` — поле
console-only, API/CLI-эквивалента нет, проверено по всему справочнику методов Object Storage API).
**Рабочая схема** — Domain name (virtual-hosted style):

```
https://<bucket>.s3.cloud.ru/<key>
```

Например: `https://3mf.s3.cloud.ru/models/{model_id}/canonical_3mf.3mf`. Global name
(`https://global.s3.cloud.ru/<global_name>/<key>`) как альтернатива не назначался — эту схему не
используем. Path-style `https://s3.cloud.ru/<bucket>/<key>` без подписи анонимных запросов не
поддерживает вообще (`missing tenant id`) — не рабочий вариант ни при каких условиях.

Живой `curl` без кред, 2026-07-09:
- `3mf` (реальный объект `models/.../drawing.svg`) → **200**, тело отдано — public-read работает.
- `generations` (временный smoke-объект, бакет в проде пока пуст — MF-707 находка) → **200**,
  объект после проверки удалён.
- `auth` (`test-key`) и `backups` (реальный архив) → **403 AccessDenied** — Domain name у приватных
  бакетов резолвится (DNS есть), но bucket policy НЕ public, поэтому анонимный GET закрыт, как и
  задумано; листинг корня (`GET /`) везде закрыт (403, не 200) — ListBucket не выдан ни одному бакету.

Это разблокировало MF-709 (Fullstack, прямая раздача моделей/превью) — контракт передан в карточку.

### ✅ Прод-cutover выполнен (MF-711, 2026-07-09)

Прод `3mf.tech` переведён на cloud.ru S3, стадийно, двумя независимыми переключателями (порядок и
откат — по инструкции CTO в карте). Оператор дал явное «да» на cutover перед стартом (Telegram,
зафиксировано в треде эпика [MF-703](mention://issue/2d8ac51f-393d-41b2-b77a-0b8877bc3bf1)).

**До переключения:** свежий бэкап (`portal.backup.sh`, env GPG/AES256 + `pg_dump`), затем
`rclone copy --checksum` + `rclone check --download` MinIO→cloud.ru по `3mf`/`auth` — **0
расхождений** (20/20 и 2/2 объектов, ничего не писалось в прод-MinIO после MF-710).

- **Переключатель A — data-plane.** `~/portal.api.env` + `~/portal.mesh.env`: `S3_ENDPOINT=https://s3.cloud.ru`,
  `S3_REGION=ru-central-1`, ключи, `S3_BUCKET_MODELS=3mf`/`S3_BUCKET_AUTH=auth`. Рестарт
  `portal.api`+`portal.mesh-worker`. Проверено на живом проде: страница модели открывается чисто
  (`webcheck`, 0 сетевых ошибок), скачивание `GET /models/:id/download.3mf` отдаёт валидный
  3MF-архив (4 MiB) через API-прокси, авторские аватары (`auth`-бакет) грузятся.
- **Переключатель B — offload прямых публичных URL (канарейка, следом за A).** Добавлены
  `S3_PUBLIC_ENDPOINT=https://s3.cloud.ru` + `S3_PUBLIC_URL_STYLE=vhost` в `portal.api.env`,
  рестарт `portal.api`. Проверено: скачивание модели теперь отдаёт `302` → редирект на
  `https://3mf.s3.cloud.ru/models/<id>/canonical_3mf.3mf` (не через API-прокси, egress с VDS
  снят) — байты идентичны прежней проксированной версии, `Content-Type`/`Content-Disposition`
  сохранены. `auth`-бакет остался приватным (прямой запрос → 403).
- **`apps/giga`** (`~/portal.giga.env`) НЕ переключался этим cutover'ом — он и так уже указывает на
  cloud.ru (`generations`), но по-прежнему работает из dev-контура (`WorkingDirectory=~/portal.ru-dev`,
  `DATABASE_URL` на `portal_dev`) — генерации ещё не смёржены в `main` (MF-661). Когда фаза
  генераций уйдёт в прод, юнит `portal.giga-worker.service` нужно перенастроить на прод-чекаут и
  прод-БД — это отдельная карта, не часть S3-cutover.
  **Устарело (см. MF-1944 выше, § `apps/giga`):** `~/portal.giga.env` с тех пор переключён на прод-БД
  (`portal`@5434) — это осталось верным только для `portal.giga-worker`/`-catalog.service`
  (намеренно на прод, реальный каталог для embeddings/AI); у `portal.giga-http.service` для
  dev-БД теперь отдельный `~/portal.giga-dev.env`.
- **Откат** (не понадобился, но проверен по инструкции): переключатель A — вернуть
  `S3_ENDPOINT=http://127.0.0.1:9000` + прежние MinIO-ключи в обоих env, рестарт; переключатель B —
  убрать оба `S3_PUBLIC_*`, рестарт. MinIO не остановлен, оба отката мгновенные и независимы друг
  от друга.

**Судьба MinIO — решение зафиксировано.** MinIO на VDS (`127.0.0.1:9000`, `/srv/minio`) **остаётся
запущенным как тёплый локальный fallback**, данные не удаляются. Это осознанный выбор, не
временная забывчивость: (1) объём тривиален (143 MiB) — нет давления по диску/памяти, чтобы
торопиться с выводом; (2) живой fallback даёт мгновенный откат при любой проблеме с cloud.ru в
первые дни после cutover, без восстановления из бэкапа; (3) вывод MinIO — необратимый шаг (данные
физически удаляются), поэтому по правилам Ops он ждёт отдельного, осознанного решения после периода
стабильности прода на cloud.ru, а не делается автоматически в одну сессию с самим cutover. Ops
держит MinIO живым и мониторит; следующий шаг (снос сервиса/данных или окончательное решение
оставить как постоянный кэш) — отдельная карта после недели наблюдения за прод-cloud.ru, не блокер
для закрытия этого эпика.

**MF-454** (S3-креды воркеров) уже был закрыт раньше (2026-07-05, фаза локального MinIO) — второго
закрытия не требуется, воркеры сейчас используют прод-креды cloud.ru по тому же env-контракту.

**Стоимость (смета, тариф от 2026-06-29, без НДС; см. [MF-705](mention://issue/bdc5b314-b292-44f3-b95b-0e9a9aaecab3) для расчёта по сценариям)** —
хранение Standard 0.93 ₽/ГБ·мес, операции GET/HEAD 0.027 ₽ и LIST/POST/PUT 0.09 ₽ за 1000
запросов/мес, исходящий трафик 0.96 ₽/ГБ·мес свыше бесплатных 10 ТБ/мес; free tier — первые
15 ГБ хранения и 1 млн GET/HEAD + 100 тыс. LIST/POST/PUT в месяц. При текущих (pre-launch) объёмах
v1 укладывается в free tier практически полностью.

Доступ (access key / secret key) — хранить только на VDS в `.env`/секрет-хранилище, никогда не коммитить.

### 🔒 Bucket-policy hardening `3mf`: приватный prefix для protected-файлов (MF-754, 2026-07-10)

**Утечка (нашёл CTO при аудите MF-39, зафиксирована `docs/epics/ids.policy.md` § «Открытая
проблема»):** после MF-709/715 весь бакет `3mf` был public-read по `arn:aws:s3:::3mf/*` — ключ
детерминирован (`models/{model_id}/{role}.{ext}`), `model_id` не секрет (виден на публичной
странице модели), значит `role='source'` (сырой загруженный файл) и прочие непубличные роли
качались напрямую с cloud.ru в обход API (сессия/статус/rate-limit/форензик — все мимо).

**Фикс — физический перенос под два префикса + policy только на `public/*`:**
- `protected/models/{model_id}/{role}.{ext}` — `source`, `canonical_3mf`, `cnc_program`,
  `drawing`, `gerber`, `code_archive`, `aux`. Bucket policy их больше НЕ покрывает — анонимный
  GET → 403 (fail-closed: default deny, а не allow-list по суффиксу).
- `public/models/{model_id}/{role}.{ext}` (и `public/models/{model_id}/description_image/{file_id}.{ext}`)
  — `preview`(`.glb`/`.mobile.glb`), `thumbnail`(`thumb.webp`), `description_image`. Единственный
  Allow-statement в policy — `Resource: arn:aws:s3:::3mf/public/*`, `Principal: "*"`, `s3:GetObject`.
- Все 20 объектов, существовавших на момент фикса, перенесены (copy → verify size (HeadObject) →
  delete старого ключа), старая плоская раскладка `models/{id}/{role}.{ext}` в бакете больше не
  используется. Живая проверка после применения policy: `protected/...` → 403, старый flat-путь →
  403 (объекта там больше нет), `public/...` → 200 (thumb.webp и preview.glb), presigned GET
  (`getSignedUrl`, TTL 60с) на `protected/...` → 200 — подписанный запрос идёт от имени
  service-account'а, bucket policy анонимов не трогает подписанные запросы владельца ключа.
  Листинг корня (`GET /`) остался 403, как и был.
- **✅ MF-755 (Fullstack) закрыта.** `apps/api/src/storage/s3.ts::modelObjectKey`, `apps/mesh/src/mesh/storage.py`,
  `apps/api/src/models/descriptionimage.ts` теперь пишут новые объекты сразу под `protected/`/`public/`
  prefix (роль решает, какой). `apps/api/src/models/download.ts` для protected-ролей (`canonical_3mf`,
  `cnc_program`/`drawing`/`gerber`/`code_archive`/`aux`) отдаёт presigned GET (TTL по умолчанию 120с,
  `Content-Disposition` подписан как часть запроса, не query-параметр поверх готовой ссылки) вместо
  голого `modelPublicUrl`. Существующие строки `model_files.s3_key`, вставленные до этой карточки,
  обновлены миграцией `db/migrations/20260710320000_model_files_protected_prefix.sql` (idempotent
  `update ... where s3_key like 'models/%'`) — переводит их на тот же prefix, куда Ops уже физически
  перенёс сами объекты.

### Таксономия данных по бакетам + retention/lifecycle (MF-706)

Матрица классов данных → бакет/ключ/видимость/PII. Ключевая схема ключей уже реализована в коде (`apps/api/src/storage/s3.ts`, `apps/giga/src/giga/storage.py`) — таксономия описывает **факт**, не предложение.

| Класс данных | Бакет | Ключ (схема) | Видимость | PII-класс | Кто пишет / где в коде |
|---|---|---|---|---|---|
| Модель — исходник до обработки (`role='source'`) | `3mf` | `protected/models/{model_id}/source.{ext}` (MF-754/755) | **приватный prefix, ACL на бакете** — анонимный GET 403, доступ только presigned; приложение как и раньше никогда не отдаёт этот файл напрямую | средний (пользовательский файл как есть, могло содержать метаданные автора) | `apps/api/src/models/upload.ts` → `putModelObjectStream` |
| Модель — каноничный 3MF (`role='canonical_3mf'`) | `3mf` | `protected/models/{model_id}/canonical_3mf.3mf` (MF-754/755) | **приватный prefix** — раздаётся ТОЛЬКО через presigned URL с коротким TTL (MF-755), больше не голым публичным URL (MF-39 anti-piracy: rate-limit/форензик на каждое скачивание) | нет (публичный контент витрины, но защищаем от неограниченного шаринга ссылки) | `apps/mesh` конвейер конвертации |
| Модель — превью/thumbnail (`role='preview'` и т.п.) | `3mf` | `public/models/{model_id}/preview.{ext}`, `.../thumb.webp` (MF-754/755) | public-read (только под `public/*`, без регрессии) | нет | `apps/mesh`, `apps/api/src/generations/catalog-draft.ts` (копия превью генерации в каталог) |
| Identity-объект авторизации | `auth` | `identities/{user_id}/{provider}.json.enc` | private | **высокий** — зашифрованный (AES-256-GCM, ключ только на VDS) слепок identity-провайдера (PlagID/email); запись — best-effort аудит, не критический путь входа | `apps/api/src/auth/plagid.ts`, `apps/api/src/auth/email.ts` → `putAuthObject` |
| Генерация — артефакт (STL/zip/png) | `generations` | `generations/{generation_id}/artifact.{ext}` | public-read (после MF-709) | низкий (сам текстовый промпт — в Postgres `generations.prompt`, не в S3; артефакт обычно не идентифицирует автора) | `apps/giga/src/giga/storage.py`, читает `apps/api/src/generations/asset.ts` |
| Генерация — превью | `generations` | `generations/{generation_id}/preview.{ext}` | public-read | низкий | то же |
| Backup — дамп Postgres (`portal`, вся БД) | `backups` | план: `postgres/portal_{timestamp}.dump` (сейчас — внутри общего архива, см. ниже) | private | **высокий** — полный дамп содержит все пользовательские данные без пообъектного шифрования | `deploy/portal.backup.sh` (сейчас пишет только на локальный диск, НЕ в S3 — см. находку ниже) |
| Backup — git bare-репозитории | `backups` | план: `git/git_repos_{timestamp}.tar.gz` | private | низкий (код), но история могла содержать случайно закоммиченные секреты | то же |
| Backup — env-файлы (`portal.api.env`, `portal.mesh.env`) | `backups` | план: `env/{service}_{timestamp}.env` | private | **высокий** — сами по себе секреты/credentials (S3-ключи, DB-пароли, session-secret), не ПДн пользователей, но компрометация = компрометация всего | то же |

**Класс данных, которому реально нет бакета в текущем коде: не найден.** Проверено по всем S3-путям в `apps/api`, `apps/mesh`, `apps/giga` — модели/аватары не хранят отдельный blob (`users.avatar_url` — просто текстовый URL, не файл в нашем S3), идеи/форум — только Postgres, без вложений. Сигнала CTO не требуется.

**Важная находка кода — `uploads/`-префикс из паспорта задачи не существует, и это ОК, не пробел.** MF-336 (решение Валерия, 2026-07-05) закрыло вопрос «хранить ли оригинал»: **храним** — исходник живёт как `role='source'` внутри `models/{model_id}/...` постоянно, отдельного временного uploads-стейджинга с TTL нет и не проектировался. Если это меняется — нужна отдельная миграция (роль `uploads_tmp` + job очистки), не входит в v1.

#### Retention / lifecycle

- **Модели (source/canonical/preview) — хранятся бессрочно.** Решение MF-336 зафиксировано. Lifecycle-удаление НЕ включаем. Открытый вопрос на будущее (не в этом стейдже) — soft-delete пользователя и судьба его S3-объектов (право на забвение, 152-ФЗ) — трек `docs/issues/007.database.design.md`, требует юридической проработки (`SECURITY.md`).
- **`auth` identity-объекты — живут, пока жива `user_identities`-строка.** Явного пути «удалить объект при удалении идентичности/аккаунта» в коде сейчас нет (сам аккаунт soft-delete ещё не спроектирован) — тот же открытый вопрос, что и выше, не дублирую отдельным пунктом.
- **`generations`-артефакты — TTL 30 дней настроен (MF-707, 2026-07-09).** Bucket lifecycle `Expiration: 30 дней` на все объекты бакета `generations` (решение CTO по MF-706) — черновики генераций, не превращённые в каталожную модель, больше не копятся бессрочно. Опубликованный контент копируется в `3mf` до истечения TTL и этим правилом не затрагивается.
- **`backups` — ротация настроена как lifecycle 30 дней в облаке (не 14, как сейчас локально), MF-707.** Офсайт-бэкап — единственная копия, переживающая полную потерю VDS, поэтому держим глубже локальной ротации. Bucket lifecycle `Expiration: 30 дней` — приближение «30 поколений» при ежесуточном бэкапе (та же логика, что и локальная 14-дневная ротация = 14 поколений).

#### ⚠️ Находка — `portal.backup.sh` не шифрует env-файлы, только переименовывает

`deploy/portal.backup.sh` (строки 38–41) делает `cp portal.api.env → portal.api.env.enc` — **это НЕ шифрование**, суффикс `.enc` вводит в заблуждение: файл копируется как есть, plaintext-секреты (S3-ключи, `DATABASE_URL`, session-secret) остаются читаемыми в архиве. Пока архив лежит только на локальном диске VDS (`chmod 600`, владелец `plag`), риск ограничен физическим доступом к самой машине — приемлемо. **Но при переносе `backups` в облако (MF-710/711) это станет реальной дырой**: секреты уйдут на cloud.ru в открытом виде под именем, которое выглядит как «уже зашифровано». Нужно реальное шифрование (`age`/`gpg` с ключом только на VDS) ДО того, как архив с env-файлами уйдёт за пределы VDS — сигнал Ops (владелец скрипта) и CTO (архитектурное решение по схеме шифрования), не блокирует эту карту, но блокирует MF-710.

#### Объём сейчас (снято живьём на прод-VDS, 2026-07-09, `mc du` против локального MinIO)

| Бакет | Размер | Объектов | Комментарий |
|---|---|---|---|
| `3mf` (прод) | 143 MiB | 20 | почти всё — 3 тестовых модели с `source.stl`+`canonical_3mf.3mf`+`preview.glb` (по ~45+15+2.5 MiB каждая) + горстка байтовых smoke-тест объектов |
| `3mf-dev` | 449 KiB | 72 | dev-стенд, мелкие тестовые файлы |
| `auth` (прод) | 415 B | 2 | 1 реальный identity-объект + 1 байтовый `test-key` (мусор от ручной проверки, не продовый) |
| `auth-dev` | 0 B | 0 | пусто |
| `generations` (прод) | 0 B | 0 | фича развёрнута, но ни одной генерации ещё не прошло полный цикл до записи артефакта на проде |
| `generations-dev` | — | 1+ | заведён 2026-07-20 (MF-2023) — до этого физически не существовал, хотя эта строка утверждала "пусто"; первый прогон trellis падал на `NoSuchBucket` при аплоаде артефакта, не на генерации/ComfyUI. **2026-07-20 (доп.):** `~/portal.giga-dev.env` держал `S3_BUCKET_GENERATIONS=generations-dev`, но `~/portal.api-dev.env` эту переменную не задавал вовсе — `apps/api/src/storage/s3.ts::generationsBucket()` падал на дефолт `"generations"`, а воркер грузил в `generations-dev`; артефакт честно лежал в S3, но `GET /generations/:id/artifact` 404'ил (искал не в том бакете) — первый раз воспроизведено вживую только сегодня, т.к. до этого ни одна генерация openscad не доходила до `status=done` (см. `docs/process/hyperpc.local.llm.md` про GigaChat→OpenRouter переключение той же ветки). Добавлена та же переменная в `portal.api-dev.env` + restart.
| `backups` (локальный диск `/srv/backups`, не S3) | 72 KiB | 2 архива | 14-дневная ротация, только на VDS-диске — бакета в облаке для этого класса пока физически нет |

**Диск VDS в целом:** `/` (30 GB) — 22 GB занято (77%), 6.7 GB свободно. **На сегодня объём тривиален** (продукт только что запущен, реального трафика загрузок ещё нет) — смета Cloud.ru (MF-705) не должна закладываться на текущие мегабайты, а на прогноз роста (модели — десятки МБ каждая, это будет доминирующая статья при реальных загрузках). Передаю цифры и вывод в [MF-703](mention://issue/2d8ac51f-393d-41b2-b77a-0b8877bc3bf1) для сметы.

### Бакет №5 — `printers-research` (MF-876, 2026-07-10)

Пятый бакет, вне раскладки v1 §4-бакетов выше — под эпик БД принтеров
([MF-839](mention://issue/3f86303f-3bca-4080-b4c8-ed72d2d0e85f) вердикт CTO: Postgres `printers` —
канон данных, бакет только под медиа-фото карточек, `docs/epics/printers.research.md` §1).

- **Провижн выполнен** (`create-bucket` + `put-bucket-policy` через boto3/S3 API, endpoint
  `https://s3.cloud.ru`, регион `ru-central-1`, тот же composite-ключ агента Cloud.ru, что и
  остальные 4 бакета). Политика — **public-read** (`s3:GetObject` для `Principal: "*"` на
  `arn:aws:s3:::printers-research/*`, без `s3:ListBucket`) — фото принтеров показываются на
  публичном каталоге `/printers`, той же логики, что `public/*`-префикс `3mf` (MF-754) и весь
  `generations`. Lifecycle не включён — медиа хранится бессрочно, как `3mf`/`auth` (карточки
  принтеров не эфемерны).
- **Layout ключей**: `printers/<id>/media/hero.webp`, `printers/<id>/media/<n>.webp` — `<id>` это
  `printers.id` (uuid канона MF-405), не `slug`.
- **Смоук-тест пройден** (2026-07-10): put/get/delete объекта по пути
  `printers/00000000-0000-0000-0000-000000000000/media/hero.webp` через тот же S3-клиент —
  байты совпали, cleanup выполнен.
- **Публичный Domain name (vhost-style `https://printers-research.s3.cloud.ru/<key>`, как у
  `3mf`/`generations`, MF-715) — НЕ включён.** Это поле console-only (нет API/CLI-эквивалента,
  подтверждено при MF-715), выставлял тогда оператор лично в личном кабинете. До включения
  анонимный публичный GET по прямому URL не резолвится (path-style без Domain name отдаёт `missing
  tenant id`, см. общую граблю выше) — раздача через presigned/proxied URL из API работает уже
  сейчас, прямой публичный URL как оптимизация — следующий шаг, отдельно от готовности этой карты.
- **Сервис-ключ**: отдельный сервис-аккаунт под этот бакет НЕ заводили — по тому же решению, что
  MF-454/707 (см. выше, «отдельного сервис-аккаунта для приложения не заводили»): API (`apps/api`)
  уже держит composite-ключ Cloud.ru в `portal.api.env`/`portal.mesh.env` для остальных 4 бакетов,
  presigned-подпись upload'ов `/research` (workstream 3, Fullstack/Back, MF-839) переиспользует тот
  же ключ — новая переменная `S3_BUCKET_PRINTERS_RESEARCH=printers-research` (имя бакета не секрет,
  сам ключ уже на VDS). Доступ команды Ресёрчеры на запись идёт только через API-гейт `/research`
  (роль `researcher`, MF-839 §4), не прямыми кредами в бакет — агенты-ресёрчеры бакет не видят.

## Env-контракт: WEB_APP_URL vs CORS_ALLOWED_ORIGINS (MF-636)
Две разные семантики, раньше жили в одной переменной (инцидент MF-633: правка под
comma-list сломала редирект после логина) — теперь разведены:
- **`WEB_APP_URL`** — единственный домен, куда `apps/api/src/auth/plagid.ts` редиректит
  после логина/ошибки. Per-env: у прод-`~/portal.api.env` свой (`https://3mf.tech`),
  у dev-`~/portal.dev.api.env` свой (`https://dev.3mf.tech`). Никогда не список.
- **`CORS_ALLOWED_ORIGINS`** — comma-list origins для CORS (`apps/api/src/server.ts`,
  только в `NODE_ENV=production`). Дефолт, если не задана, = `WEB_APP_URL`. Нужна только
  на **прод**-инстансе, потому что dev-фронт (`dev.3mf.tech`) ходит в прод-API
  (`api.3mf.tech`) и должен пройти CORS: `CORS_ALLOWED_ORIGINS=https://3mf.tech,https://dev.3mf.tech`.
  На dev-инстансе не нужна — там `NODE_ENV=development` → CORS уже открыт (`origin: true`).
- Обе переменные правит только Ops в соответствующем `EnvironmentFile` на VDS.

## Домены
- `3mf.tech` — портал (nginx, статика `apps/web/dist`). **SPA-фолбэк обязателен (MF-524):** витрина «Проекты» на path-маршруте `/project` (+ `/project/:id`), поэтому `location /` должен отдавать `index.html` на все не-файловые пути (`try_files $uri $uri/ /index.html;`) — иначе прямой заход/F5 на `/project*` даёт 404. Референс-vhost и чеклист проверки — `deploy/nginx.3mf.tech.conf` (владелец живого конфига — Ops).
- `api.3mf.tech` — API (nginx reverse proxy → `apps/api` на `127.0.0.1:3000`)
- DNS — регистратор/NS Timeweb, A-записи обоих доменов указывают на VDS.
- **Актуально на 2026-07-17 (MF-1406): A-записи `3mf.tech`/`api.3mf.tech` всё ещё указывают на orphaned VDS `176.123.160.18`, НЕ на рабочий прод `dev-3mf` (`82.202.159.148`).** Перепроверено живьём: `dig 3mf.tech`/`api.3mf.tech` → `176.123.160.18`, `curl https://3mf.tech/`/`https://api.3mf.tech/health` → `200` с этой же машины; `82.202.159.148` при этом отдаёт актуальный код напрямую (`curl -k -H "Host: 3mf.tech" https://82.202.159.148/` → `200`). Cutover требует правки записей у регистратора (Timeweb) — Ops-агент не имеет туда доступа (нет credentials/API-ключа Timeweb в окружении), правку может сделать только оператор. Карточка [MF-1406](mention://issue/da3c2292-3997-4413-97ab-c657f2037210) — держит статус, ждёт операторского действия; предыдущая попытка [MF-883](mention://issue/298afc38-f5e4-4d59-b96a-d6ea2e6e2b7b) отменена без выполнения по той же причине (недоступны креды).
- **TLS — выпущен и работает** (`certbot --nginx`, Let's Encrypt, HTTP-01, автопродление). Задержка на старте (внешний 80/443 не отвечал несколько часов, хотя `security group` в панели cloud.ru была настроена верно) оказалась просто медленным применением правила на стороне облака, не отдельным сервисом/файрволом — см. `docs/issues/008.vds.runtime.md`/`docs/issues/009.dns.cloudru.md`.
- **OG-мета соцкраулеров (MF-827)** — `map $http_user_agent $is_social_crawler` (уровень `http{}`) + `location /` в обоих vhost'ах проксирует ботов (Telegram/FB/Twitter/Slack/LinkedIn/WhatsApp/Discord/vk/Pinterest/Skype/Google-InspectionTool/Applebot) на `GET /seo/meta?path=...` (`apps/api/src/seo/meta.ts`, MF-505) вместо пустого SPA-шелла. Вмёржено в живой `dev.3mf.tech` 2026-07-10 — проверено `curl -A TelegramBot https://dev.3mf.tech/project/<id>` (компактный `<head>` с og-тегами, не SPA) и webcheck (обычный UA → полноценная страница, консоль чистая). **Порт апстрима на dev — 3200, не 3001** (репо-шаблон `deploy/nginx.dev.3mf.tech.conf` содержал опечатку с 3001, где ничего не слушает — исправлено; на dev.3mf.tech `apps/api` слушает `127.0.0.1:3200`, см. `portal.api-dev.service`, 3100/3001 заняты Multica-инфраструктурой той же VDS). Прод (`nginx.3mf.tech.conf`, порт 3000) — тот же паттерн, вмёржен в живой конфиг Ops 2026-07-10 (MF-505): бэкап `3mf.tech.conf.bak.20260710232341` в `/etc/nginx/sites-available/`, `nginx -t && systemctl reload nginx`, проверено `curl --resolve 3mf.tech:443:127.0.0.1 -A TelegramBot https://3mf.tech/project` → `og:title`/`og:image`/`canonical` (компактный `<head>`, не SPA), обычный UA на том же пути по-прежнему получает SPA-шелл. Прод-БД на момент проверки пуста (`models` — 0 строк), поэтому per-модельный `og:image` живьём не проверен — маршрутизация идентична уже провалидированной на dev. Финальная проверка через публичный домен `3mf.tech` остаётся заблокирована MF-882/MF-883 (DNS указывает на другую, «осиротевшую» машину) — этот блок трогает только живой `/etc/nginx/sites-enabled/3mf.tech.conf` на deploy-VDS, не DNS. **Доп. фикс (MF-827, 2026-07-10): `API_PUBLIC_URL` в `~/portal.api-dev.env`.** `apps/api/src/seo/urls.ts` без этой переменной резолвил `og:image` на дефолт кода (`https://api.3mf.tech`, прод-хост) — на dev картинка 404-илась (модели физически нет в прод-БД/-бакете). Добавлена строка `API_PUBLIC_URL=https://api.dev.3mf.tech` в живой `~/portal.api-dev.env` + `systemctl restart portal.api-dev`. Живая проверка: залил тестовую модель через `POST /models` (служебная сессия), дождался `ready`, `curl -A TelegramBot https://dev.3mf.tech/project/<id>` отдал `og:image` на `api.dev.3mf.tech/seo/models/<id>/og.webp` → `200` без авторизации (как реально фетчит краулер); тестовую модель удалил. Прод (`~/portal.api.env`) не трогали — там дефолт кода уже совпадает с прод-доменом.

## Аналитика — Umami (MF-725)

Umami (поведенческая аналитика, self-hosted) поднята стеком Docker Compose на **dev-VDS**
(`~/umami`, контейнеры `umami` + `umami-db`, порт `3400`). Сайты зарегистрированы: `dev.3mf.tech` =
`f33554f5-0758-4ee8-9778-a439f15ba309`, `3mf.tech` = `ff13e9d7-944c-4c5b-a357-b70ea41dd7d4`.

Публичный трекер проксируется same-origin через `location /_a/` (не отдельный поддомен, чтобы
скрипт не резался блокировщиками рекламы и работал без CORS):
- `dev.3mf.tech` → `location /_a/` проксирует на `127.0.0.1:3400` (тот же VDS).
- `3mf.tech` (прод-VDS `ru-4gb-16018`) → `location /_a/` проксирует на `100.121.25.101:3400` —
  Tailscale-адрес dev-VDS. Порт `3400` в Docker слушает и `127.0.0.1`, и Tailscale-интерфейс
  (`ports: ["127.0.0.1:3400:3000", "100.121.25.101:3400:3000"]` в `~/umami/docker-compose.yml`),
  наружу (публичный IP) не торчит — доступ только по тейлнету, без файрвола на этот случай не
  полагаемся.

Референс-vhost — `deploy/nginx.dev.3mf.tech.conf` / `deploy/nginx.3mf.tech.conf` (владелец живого
конфига — Ops, как и остальные vhost'ы в этом разделе). Embedding трекера в `apps/web`
(`<script defer src="/_a/script.js" data-website-id="...">`, id разный для dev/prod через
`VITE_UMAMI_WEBSITE_ID`) — зона Front, не Ops (Ops не пишет прод-код приложений).

## Исходящий трафик VDS через Tailscale exit-node (обход гео-блока Anthropic)

**Зачем.** VDS — российский IP. Anthropic (`api.anthropic.com`, `claude.ai`) отдаёт `403` на запросы с российских IP — это блокирует и установку/логин Claude Code, и (предположительно) саму работу инференса. Нужен агент-CLI на VDS для демона Multica (см. `docs/process/multica.md` § «Режим B»). Решение — заворачивать ИСХОДЯЩИЙ трафик самого VDS через Tailscale exit-node в другой стране (сейчас `se-300mb-1537`, физически отдаёт IP Финляндии).

**Грабля (важно, чуть не уронили прод):** `tailscale set --exit-node=<node>` переопределяет ДЕФОЛТНЫЙ маршрут машины — вставляет `0.0.0.0/1` + `128.0.0.0/1` через `tailscale0` (они специфичнее `/0`, значит приоритетнее обычного дефолта). Это ломает не только новые исходящие соединения самого сервера, но и **ОТВЕТЫ на входящие**: пакет-ответ клиенту снаружи (nginx на 80/443, sshd на 22) снова роутится по destination и улетает в `tailscale0` вместо прямого аплинка — сайт/API/доска и прямой SSH становятся недоступны снаружи целиком. Именно так и произошло при первом включении — прод лежал несколько минут, пока не поставили фикс ниже.

**Фикс — policy routing.** Пакеты, у которых ИСХОДНЫЙ адрес = публичный IP VDS (на `dev-3mf`, живой машине, это `82.202.159.148` — см. поправку MF-883 в начале раздела; старый текст ниже про `176.123.160.18` относится к отдельной осиротевшей машине и не актуален для `dev-3mf`), всегда идут через отдельную таблицу маршрутизации `wanout` (только реальный шлюз провайдера, `enp3s0`/`82.202.158.1` на `dev-3mf`), приоритет этого `ip rule` (100) выше, чем правила самого Tailscale (5210+). Всё остальное (что генерируют процессы на VDS — `claude`, `curl`, `apt`, демон Multica) — как обычно через дефолтный маршрут, который exit-node переопределяет на FI. Проверено живьём на `dev-3mf` 2026-07-10 (MF-883): `ip rule show` содержит `from 82.202.159.148 lookup wanout`, скрипт `/usr/local/sbin/wan-policy-routing.sh` на месте.

- Скрипт: `/usr/local/sbin/wan-policy-routing.sh` (идемпотентный, не в git — правится руками на VDS, как остальные скрипты вне репо).
- Юнит: `systemctl status wan-policy-routing.service` (oneshot, `RemainAfterExit=yes`, `After=tailscaled.service`) — применяет правило заново при каждой загрузке, до/независимо от того, поднят ли exit-node.
- Проверка после любого вмешательства в сеть на VDS (обязательно оба направления):
  ```bash
  # снаружи (с любой другой машины, не с VDS):
  curl -o /dev/null -w '%{http_code}\n' https://3mf.tech/
  curl -o /dev/null -w '%{http_code}\n' https://api.3mf.tech/health
  curl -o /dev/null -w '%{http_code}\n' https://tasks.3mf.tech/
  ssh <прямой публичный IP или Tailscale-хост vds> true   # прямой SSH тоже должен жить

  # на VDS — исходящий трафик реально ушёл в exit-node:
  curl https://ipinfo.io/country   # должно быть НЕ RU
  ```
- Откат в аварии (если prod снова недоступен снаружи после сетевых правок): `sudo tailscale set --exit-node=` (пустое значение снимает exit-node, дефолтный маршрут возвращается на WAN мгновенно) — это ПЕРВОЕ действие при любом подозрении, разбираться в причине можно после.

**Как добавить новое исключение** (ещё один сервис/IP, который должен всегда ходить напрямую через WAN, а не через exit-node):
1. Открой `/usr/local/sbin/wan-policy-routing.sh` на VDS.
2. Добавь ещё один `ip rule add from <ip-или-под-условие> table wanout priority <100+N>` по образцу существующей строки (тот же паттерн: сначала проверка `ip rule show | grep -q ...`, чтобы скрипт оставался идемпотентным).
3. Если исключение не по source-IP, а по конкретному внешнему хосту/сети, на которые VDS должен стучаться напрямую (не через exit-node) — это уже НЕ source-based, а destination-based правило: `ip route add <cidr> via 176.123.160.1 dev enp3s0` (без отдельной таблицы, просто более специфичный маршрут в основной таблице — специфичный маршрут всегда бьёт `/1`-переопределение exit-node).
4. Прогони скрипт руками (`sudo /usr/local/sbin/wan-policy-routing.sh`) и проверь по чеклисту выше — только после зелёного результата коммить эту логику как постоянную (юнит уже подхватит скрипт при следующей загрузке автоматически).
5. Опиши новое исключение здесь же (эта секция) — список правил в скрипте должен совпадать со списком в доке.

## CI/CD-раннер (деплой)

Self-hosted GitVerse Actions runner (`act_runner`) на самом VDS, метка `deploy` — деплой-джобы (`.gitverse/workflows/release.yaml`/`deploy.yaml`) выполняются прямо на целевой машине: не нужны SSH-секреты в CI, `git pull`+перезапуск локальны. Используется **только** для деплоя, не для lint/test/build чужих PR (см. `SECURITY.md`).

**Состояние: подготовлено, не зарегистрировано.** Рабочая директория `~/gitverse.runner` и `~/gitverse.runner/gitverse.runner.service` (systemd-юнит) на VDS готовы.

**Проверено 2026-07-03 (статус актуален):** апстрим-бинарь `act_runner` с `dl.gitea.com` **не совместим** — падает на `Cannot ping the Gitea instance server: error=unimplemented` (GitVerse форкнул gRPC-протокол раннера, аналогично переименованию `github.*`→`gitverse.*` в Actions-контексте). Нужен именно патченый бинарь с самой панели. Отслеживание — `docs/issues/006.runner.register.md`.

- **Токен регистрации** — можно получить через API (не только UI): `POST https://api.gitverse.ru/repos/plag/portal.ru/actions/runners/registration-token` с заголовками `Authorization: Bearer <PAT>` + `Accept: application/vnd.gitverse.object+json;version=latest` → `{"token": "..."}`.
- **Бинарь** — только с gitverse.ru/plag/portal.ru → Settings → Actions → Runners → Add Runner → скачать под linux/amd64 (НЕ с dl.gitea.com).

На VDS:
```bash
cd ~/gitverse.runner
# положить сюда бинарь именно с панели GitVerse, затем:
chmod +x act_runner
./act_runner register --no-interactive \
  --instance https://gitverse.ru \
  --token <ТОКЕН> \
  --name ru-4gb-16018 \
  --labels deploy:host
sudo cp gitverse.runner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gitverse.runner.service
```
Проверить: Settings → Actions → Runners — раннер должен появиться со статусом online.

## GitVerse Public API — что реально поддержано (сверено с [офиц. документацией](https://gitverse.ru/docs/developers/public-api), 2026-07-03)

**⚠️ Обязательный заголовок на КАЖДЫЙ запрос:** `Accept: application/vnd.gitverse.object+json;version=latest` (плюс `Authorization: Bearer <PAT>`) — без него любой, даже валидный запрос отдаёт 400 с пустым телом. Base URL — `https://api.gitverse.ru`, НЕ `gitverse.ru/api/`.

**Поддержано (можно использовать программно):**
- Репозитории — `GET/PATCH /repos/{owner}/{repo}`, список веток, файлы/содержимое (`contents`), коммиты, git refs, форки, collaborators.
- Pull requests — `GET/POST /repos/{owner}/{repo}/pulls`.
- Releases — `GET/POST /repos/{owner}/{repo}/releases`.
- **Actions — секреты и переменные репозитория программно:** `PUT /repos/{owner}/{repo}/actions/secrets/{name}` (создать/обновить), `DELETE`, `GET` (список/по имени) — то же для `/actions/variables` (+`POST`/`PATCH`). Пригодится, когда появятся реальные секреты для CI (см. `SECURITY.md`) — не обязательно руками через UI.
- **Actions — ручной запуск workflow:** `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` — можно триггерить `workflow_dispatch` (напр. `release.yaml` с `action=release`) программно, не только кнопкой в UI.
- **Actions — раннеры:** `POST .../actions/runners/registration-token` (токен — да), список/удаление раннера — да. Сама регистрация раннера (biнарь+пинг) — только UI-бинарь, см. выше.

**НЕ поддержано в принципе (подтверждено — не баг, не недокументированный путь, а отсутствующая возможность API):**
- **Issues/задачи** — раздел «[Задачи](https://gitverse.ru/docs/collaborative/tasks)» в доках описан **только для веб-интерфейса**, в Public API эндпоинтов для issues нет вообще.
- **Branch protection** — нет в [полном списке из 21 эндпоинта Repositories API](https://gitverse.ru/docs/developers/public-api/repositories).
- **Wiki** — не упоминается в Public API вообще; вики — отдельный git-репозиторий (`<repo>.wiki.git`), инициализируется только первым сохранением через UI.

Все три — только через `gitverse.ru/plag/portal.ru` в браузере.
