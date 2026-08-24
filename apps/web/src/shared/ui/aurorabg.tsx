import type { CSSProperties } from "react";
import "./aurorabg.css";

// Фоновая размытая анимация («портал») позади карточки логина — статичный
// луч-прожектор + 3 медленно дрейфующих blur-пятна на --accent/--accent2 +
// лёгкое зерно (референс — «Киоск 3D-печати»). Только transform-анимация
// у пятен (не анимируем filter/backdrop-filter — дорого на перерисовку),
// off при prefers-reduced-motion.
const auroraTimelineStartedAt = Date.now();

export function AuroraBackground({ className }: { className?: string } = {}) {
  // Экранные компоненты перемонтируются на каждом route, но фон должен ощущаться одним
  // непрерывным слоем приложения. Отрицательная задержка продолжает общую временную шкалу
  // модуля вместо перезапуска всех трёх blob-анимаций с нулевого кадра.
  const phaseStyle = {
    "--aurora-phase": `${-(Date.now() - auroraTimelineStartedAt)}ms`,
  } as CSSProperties;

  return (
    <div className={["aurorabg", className].filter(Boolean).join(" ")} style={phaseStyle} aria-hidden="true">
      <div className="aurorabgSpotlight" />
      <div className="aurorabgBlob aurorabgBlob1" />
      <div className="aurorabgBlob aurorabgBlob2" />
      <div className="aurorabgBlob aurorabgBlob3" />
      <div className="aurorabgGrain" />
    </div>
  );
}
