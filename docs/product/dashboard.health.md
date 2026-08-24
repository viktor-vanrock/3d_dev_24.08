# Дашборд здоровья продукта

**MF-733, Фаза 2 эпика MF-41 (см. [MF-430](../epics/analytics.events.md)), stage 2 — после
метрик MF-731/MF-732.** Один внутренний ops-дашборд (`/internal/product-health`,
`apps/web/src/pages/producthealth.tsx`), читающий `GET /analytics/health`
(`apps/api/src/analytics/health.route.ts`, под обычным session-гейтом — тот же приём, что
`/catalog/metrics`/`/internal/catalog-metrics`, отдельной admin-роли в `SessionUser` пока нет).
Обновление — на каждый заход на страницу (клиентский `fetch`, не статический снапшот).

Три блока — переиспользуют уже задокументированные функции/вьюхи sibling-карточек, не копируют
SQL:

1. **Воронка регистрация → активация → первое скачивание** — `funnel()`,
   `apps/api/src/analytics/metrics.product.ts`. Новая функция этой карточки (в MF-732 её не
   было — там были только Acquisition/Retention/Revenue/Referral). Когорта — юзеры с `signup`
   за окно (30д, тот же паттерн, что `retention()`); "активация" — реальное событие
   `aha_reached` (`ACTIVATION_EVENT_NAMES`, `analytics/events.ts`, эмитится
   `POST /me/activation/events`, `profile/activation.ts`) — не proxy на `model_view`, это уже
   формализованный "ага"-момент воронки активации (Фаза 3, `analytics.events.md` §
   «Activation-контур»); "первое скачивание" — `model_download` ТЕМ ЖЕ юзером после `signup`
   (не любой download в системе).
2. **DAU/MAU + stickiness** — `dauWauMau()`, `apps/api/src/analytics/metrics.community.ts`
   (MF-732, без изменений).
3. **Liquidity/match-rate маркетплейса** — вьюхи `marketplace_liquidity_30d` и
   `marketplace_search_match_rate_30d`, `apps/api/db/migrations/20260710240000_marketplace_metrics_views.sql`
   (MF-731, без изменений); формулы и обоснование окон — [metrics.marketplace.md](metrics.marketplace.md).

## Проверено (2026-07-11, dev-БД, docker compose postgres после db:migrate)

Пустая БД (только что смигрирована, без seed-данных) — все три блока отвечают честными нулями/
`null`, без ошибок:

```
funnel:      signups=0, activated=0, downloaded=0, activation_pct=0, download_pct=0
activity:    dau=0, wau=0, mau=0, stickiness_pct=0
marketplace: published_models_30d=0, liquidity_rate=null, search_to_download_match_rate=null
```

Это ожидаемое поведение пустого каталога (`nullif`/`coalesce` на 0 знаменателях — см.
`metrics.marketplace.md` § «Проверка»), не баг агрегации. `GET /analytics/health` под сессией
возвращает `200` с этой структурой (`apps/api/src/analytics/health.route.test.ts`, 2 теста), без
сессии — `401`.
