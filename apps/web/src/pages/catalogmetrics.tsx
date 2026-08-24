import { useEffect, useState } from "react";
import { getCatalogMetrics, type CatalogMetrics } from "@domains/commerce";
import { AuroraBackground, Eyebrow, Heading, StatTile } from "@shared/ui";

// Дашборд покрытия каталога (MF-647, соседняя backend-карточка MF-645, эпик MF-32/MF-407 §
// «Дашборд покрытия и свежести базы»): 4 плитки на живых данных `GET /catalog/metrics`.
// Внутренний раздел (`/internal/catalog-metrics`) — под обычным AuthGate (эндпоинт требует
// только сессию, отдельной admin-роли в SessionUser пока нет, см. auth/session.ts); в основную
// табную навигацию (NAV_ITEMS) не добавлен, заходят по прямой ссылке — как и `/kitchen-sink`.
export function CatalogMetricsPage() {
  const [metrics, setMetrics] = useState<CatalogMetrics | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMetrics(null);
    setLoadError(false);
    void getCatalogMetrics().then((result) => {
      if (cancelled) return;
      if (!result) {
        setLoadError(true);
        return;
      }
      setMetrics(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "24px 16px 80px" }}>
        <Eyebrow>Покрытие каталога</Eyebrow>
        <Heading size="md">Дашборд каталога</Heading>

        {loadError ? (
          <div style={{ color: "var(--text-dim)", marginTop: 24 }}>Не удалось загрузить метрики. Обновите страницу.</div>
        ) : (
          <div className="uiStatTileGrid" style={{ marginTop: 24 }}>
            <StatTile
              label="Всего моделей"
              value={metrics ? metrics.total_models : "…"}
              tone={metrics ? "ok" : "dim"}
            />
            <StatTile
              label="Полные спеки"
              value={metrics ? `${metrics.complete_specs_pct}%` : "…"}
              tone={completenessTone(metrics?.complete_specs_pct)}
            />
            <StatTile
              label="Верифицировано"
              value={metrics ? `${metrics.verified_pct}%` : "…"}
              tone={completenessTone(metrics?.verified_pct)}
            />
            <StatTile
              label="Свежесть (медиана)"
              value={formatFreshness(metrics?.median_freshness_days, metrics === null)}
              hint={metrics?.median_freshness_days != null ? "дней с последней проверки" : undefined}
              tone={freshnessTone(metrics?.median_freshness_days)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Ниже 50% — сигнал дрейфа (docs/design/marketplace.v2.md §6.2 «яркость=важность»: тускло —
// ок/пусто, ярче — важно/требует внимания); выше — обычная приглушённая плитка.
function completenessTone(pct: number | undefined): "dim" | "warn" {
  if (pct === undefined) return "dim";
  return pct < 50 ? "warn" : "dim";
}

function freshnessTone(days: number | null | undefined): "dim" | "warn" {
  if (days === undefined || days === null) return "dim";
  return days > 90 ? "warn" : "dim";
}

function formatFreshness(days: number | null | undefined, loading: boolean): string {
  if (loading) return "…";
  if (days === null || days === undefined) return "—";
  return String(days);
}
