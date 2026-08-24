import type { PullToRefreshPhase } from "./pulltorefresh.ts";
import "./pulltorefresh.css";

// Круговой refresh-индикатор (touch.nav.md §3): растёт вместе с протяжкой (distance — px, тот же
// rubber-band, что даёт usePullToRefresh), приглушён до порога, доливается до --accent на ready,
// крутится на loading, вспыхивает на success и схлопывается.
export function PullToRefreshIndicator({ phase, distance }: { phase: PullToRefreshPhase; distance: number }) {
  if (phase === "idle") return null;
  return (
    <div className="ptrIndicator" data-phase={phase} style={{ height: `${distance}px` }} aria-hidden="true">
      <span className="ptrIcon" data-spin={phase === "loading" || undefined}>
        <RefreshIcon />
      </span>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
