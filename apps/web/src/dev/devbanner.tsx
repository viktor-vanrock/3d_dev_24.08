import version from "../../../../version.json";
import "./devbanner.css";

// Индикатор dev-среды рендерится исключительно в отдельной dev-сборке. Он живёт
// поверх shell, не резервируя высоту и не перехватывая действия пользователя.
const APPLICATION_VERSION = `v${version.year}.${version.release}.${version.minor}`;

export function DevBanner() {
  if (import.meta.env.VITE_DEV_BANNER !== "1") return null;

  return (
    <div className="devEnvironmentBadge" role="status" aria-label={`Тестовая среда разработки, ${APPLICATION_VERSION}`}>
      <strong>DEV</strong>
      <span>данные тестовые</span>
      <span aria-hidden="true">·</span>
      <span>{APPLICATION_VERSION}</span>
    </div>
  );
}
