# Сид dev-среды — раздел для `docs/infra/dev.md`

> Владелец `docs/infra/` — Ops (решение Lead, «Итоги совета» MF-532). Этот файл — **готовый
> раздел «Сид»**, который Ops вкладывает в `docs/infra/dev.md` при сборке доки среды (Stage 3).
> Владелец самого сида и данных — Data (эпик MF-532, карточка MF-535).

Сид наполняет dev-среду (`dev.3mf.tech`) данными каталога/hero, чтобы ревью шло по живому UI,
а не по пустым экранам. Живёт в репо и гоняется по требованию — при рассинхроне со схемой после
миграций просто пере-сеивается (владение — Data).

## Что кладёт (слой 1 — синтетика)

- **4 dev-юзера**, включая `devuser` (он же dev-админ, `ADMIN_USERNAMES=devuser`).
- **20 моделей** `status='ready'` разных форматов (stl/3mf/step/obj), авторов и тегов.
- Каждой модели: **`preview.glb`** (один из 6 GLB-примитивов) и **`role='thumbnail'` webp** —
  каталог и карточки не пустые; three.js-вьюер на `/project` и в hero рендерит реальную геометрию.
- **5 моделей помечены `featured`** — hero-карусель (`GET /models?featured=1`) наполнена.
- Объекты физически кладутся в dev-бакет **`3mf-dev`** (стримятся ручкой `GET /models/:id/preview.glb`
  и `…/thumb.webp`, `apps/api/src/models/asset.ts`).

Фикстуры (`apps/api/scripts/fixtures/*.glb`, `*.webp`) — детерминированные, лежат в репо. Перегенерация
(меняешь только если правишь сами примитивы): `pnpm --filter @portal/api fixtures:gen`.

### Слой 2 (hero-копия реальных прод-моделей) — снят с критического пути

По плану сид двухслойный: слой 2 — read-only копия реальных прод-ready-моделей (строки + `preview.glb`
из прод-MinIO → `3mf-dev`) для осмысленного отбора hero. **Дешёвая проверка прод-пула (08.07): на проде
3 ready-модели с preview — меньше порога 6.** Значит fast-path hero-над-реальными-моделями невозможен →
PM триггерит fallback по MF-531 (оператор шлёт проекты, Back метит на проде admin-путём). В сид слой 2
не входит; заводится отдельным прогоном на стенде, когда прод-пул дорастёт до ≥6.

## Как засидить

```bash
# env dev-инстанса (~/portal.dev.api.env): DATABASE_URL на portal_dev, S3_* на бакет 3mf-dev,
# S3_BUCKET_MODELS=3mf-dev, NODE_ENV=development
pnpm --filter @portal/api seed:dev
```

Флаги:
- `--no-migrate` — не гонять `migrate()` первым шагом (по умолчанию гоняет — идемпотентный DDL).
- `--skip-assets` — только строки в БД, без заливки объектов в бакет (для быстрой проверки схемы).

Скрипт **идемпотентен**: повторный запуск досеивает/обновляет по детерминированным UUID, ручной
хирургии не требует. Пере-сеять после миграции — просто запустить снова.

## Предохранители (почему не тронет прод)

Сид **падает до любой записи**, если:
- `NODE_ENV=production`;
- имя БД — `portal` (прод-БД, безусловный денилист);
- имя БД ≠ `portal_dev` (переопределяется `SEED_DB_NAME` для нестандартного стенда, но `portal`
  запрещён всегда);
- нет `DATABASE_URL`.

Прод живёт в БД `portal` (CLAUDE.md) — гейт отсекает его физически. Заливка ассетов идёт только в
бакет из `S3_BUCKET_MODELS` (на dev = `3mf-dev`), в прод-бакет `3mf` сид не пишет.

## Как проверить

```bash
# в самом выводе сида — сводка: users/models/ready/featured/preview/thumbnail
# каталог глазами API:
psql "$DATABASE_URL" -c "select count(*) from models where status='ready'"          # 20
psql "$DATABASE_URL" -c "select count(*) from model_files where role='preview'"      # 20
psql "$DATABASE_URL" -c "select count(*) from model_files where role='thumbnail'"    # 20
psql "$DATABASE_URL" -c "select count(*) from models where featured_at is not null"  # 5
# hero отдаёт 5 слайдов (после dev-входа сессией):
curl -s "$API/models?featured=1" | jq '.models | length'                            # 5
# ассеты реально стримятся (не 404):
curl -sI "$API/models/<id>/preview.glb"   # 200, Content-Type: model/gltf-binary
curl -sI "$API/models/<id>/thumb.webp"    # 200, Content-Type: image/webp
```

## Как перезапустить / пересеять

Повторный `pnpm --filter @portal/api seed:dev` — идемпотентно. Чтобы начать с чистого листа: пересоздать
БД `portal_dev` и бакет `3mf-dev`, затем сид с `migrate()` (дефолт).

## Живой принтер (`GET /me/printers/:id/live`) — фикстуры состояний (MF-1952)

> Владение фикстурой — контур устройств/API (Back), не Data — задета `apps/api/src/profile/activation.ts`
> и `apps/api/db` не менялись (схема уже поддерживала все нужные поля), только data-seed.

`pnpm --filter @portal/api seed:dev` (шаг `upsertDevLivePrinterFixtures`, `apps/api/scripts/seed-dev-live-printers.ts`)
идемпотентно публикует **7 принтеров с фиксированными id** под служебным webcheck-юзером
`autofab-agent` (та же сессия, что использует `webcheck`/curl из раздела «Как зайти» выше) — по одному
на каждый контрактный `live_availability_reason` из `apps/api/src/profile/contract.ts`:

| `live_availability_reason` | `state` (device_state.status) | `user_printers.id` |
|---|---|---|
| `no_telemetry_channel` | `offline` (агент никогда не отчитывался) | `20000000-1952-4000-8000-000000000001` |
| `available` | `printing` | `20000000-1952-4000-8000-000000000002` |
| `available` | `paused` | `20000000-1952-4000-8000-000000000003` |
| `available` | `error` | `20000000-1952-4000-8000-000000000004` |
| `offline` | `offline` | `20000000-1952-4000-8000-000000000005` |
| `stale` | `ready` (снимок искусственно состарен) | `20000000-1952-4000-8000-000000000006` |
| `permission_denied` | `offline` (agent revoked) | `20000000-1952-4000-8000-000000000007` |

Проверка (owner-сессия `autofab-agent`, `TOKEN=$(cat ~/.autofab-session-dev)`):

```bash
curl -s -H "Cookie: portal_session=$TOKEN" \
  https://api.dev.3mf.tech/me/printers/20000000-1952-4000-8000-000000000002/live | jq '.live_availability_reason, .state'
# "available"
# "printing"
```

**"available" (printing/paused/error) честно деградирует.** `device_state.updated_at` фиксируется в
`now()` на момент прогона, а `DEVICE_STATE_STALE_AFTER_MS` (45с, `contract.ts`) неумолимо переводит их
в `stale` дальше — как ведёт себя настоящая телеметрия, фикстура не притворяется вечно живой. Освежить
прямо перед проверкой, без полного `seed:dev` (не грузит модели/S3, доли секунды):

```bash
pnpm --filter @portal/api seed:dev:live-printers
```

`offline`, `permission_denied`, `stale`, `no_telemetry_channel` от времени не зависят — воспроизводятся
всегда, без тайминга.

Тот же двойной предохранитель, что у остального сида (вынесен в `apps/api/scripts/dev-seed-guard.ts`,
общий для `seed-dev.ts` и `touch-dev-live-printers.ts`): падает при `NODE_ENV=production` или БД, отличной
от `portal_dev`/`SEED_DB_NAME`, БД `portal` — безусловный денилист.

Контрактные тесты фикстуры — `apps/api/scripts/seed-dev-live-printers.test.ts` (все 7 состояний +
owner-only 404 для чужого id, идемпотентность повторного прогона); сам контракт покрыт
`apps/api/src/profile/activation.test.ts` (`describe("GET /me/printers/:id/live")`).
