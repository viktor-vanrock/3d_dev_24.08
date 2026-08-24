import { useEffect, useState } from "react";
import { getProductHealth, type ProductHealth } from "../analytics/health.ts";
import { AuroraBackground, Eyebrow, Heading, StatTile } from "@shared/ui";

// Дашборд здоровья продукта (MF-733, Фаза 2 эпика MF-41, stage 2 — после MF-731/MF-732):
// три блока на живых данных `GET /analytics/health` — воронка регистрация→активация→скачивание,
// DAU/MAU+stickiness, liquidity/match-rate маркетплейса. Внутренний раздел
// (`/internal/product-health`) — тот же приём, что `/internal/catalog-metrics`: под обычным
// AuthGate (эндпоинт требует только сессию), в NAV_ITEMS не добавлен, заходят по прямой ссылке.
export function ProductHealthPage() {
  const [health, setHealth] = useState<ProductHealth | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHealth(null);
    setLoadError(false);
    void getProductHealth().then((result) => {
      if (cancelled) return;
      if (!result) {
        setLoadError(true);
        return;
      }
      setHealth(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Eyebrow>Здоровье продукта</Eyebrow>
        <Heading size="md">Дашборд здоровья</Heading>

        {loadError ? (
          <div style={{ color: "var(--text-dim)", marginTop: 24 }}>Не удалось загрузить метрики. Обновите страницу.</div>
        ) : (
          <>
            <Eyebrow>Воронка: регистрация → активация → скачивание</Eyebrow>
            <div className="uiStatTileGrid" style={{ marginTop: 12 }}>
              <StatTile label="Регистрации (30д)" value={health ? health.funnel.signups : "…"} tone={health ? "ok" : "dim"} />
              <StatTile
                label="Активированы"
                value={health ? `${health.funnel.activated} (${health.funnel.activation_pct}%)` : "…"}
                tone="dim"
              />
              <StatTile
                label="Скачали хоть раз"
                value={health ? `${health.funnel.downloaded} (${health.funnel.download_pct}%)` : "…"}
                tone="dim"
              />
            </div>

            <Eyebrow>DAU/MAU</Eyebrow>
            <div className="uiStatTileGrid" style={{ marginTop: 12 }}>
              <StatTile label="DAU" value={health ? health.activity.dau : "…"} tone={health ? "ok" : "dim"} />
              <StatTile label="WAU" value={health ? health.activity.wau : "…"} tone="dim" />
              <StatTile label="MAU" value={health ? health.activity.mau : "…"} tone="dim" />
              <StatTile
                label="Stickiness"
                value={health ? `${health.activity.stickiness_pct}%` : "…"}
                tone={stickinessTone(health?.activity.stickiness_pct)}
              />
            </div>

            <Eyebrow>Liquidity маркетплейса</Eyebrow>
            <div className="uiStatTileGrid" style={{ marginTop: 12 }}>
              <StatTile
                label="Опубликовано моделей (30д)"
                value={health ? health.marketplace.published_models_30d : "…"}
                tone={health ? "ok" : "dim"}
              />
              <StatTile
                label="Liquidity rate"
                value={health ? formatRate(health.marketplace.liquidity_rate) : "…"}
                tone="dim"
              />
              <StatTile
                label="Search → download match-rate"
                value={health ? formatRate(health.marketplace.search_to_download_match_rate) : "…"}
                tone="dim"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function stickinessTone(pct: number | undefined): "dim" | "warn" {
  if (pct === undefined) return "dim";
  return pct < 10 ? "warn" : "dim";
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}
