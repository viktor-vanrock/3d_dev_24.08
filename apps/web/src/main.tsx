import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { DevBanner } from "./dev/devbanner.tsx";
import { initUmamiTracking } from "@platform/consent";
import { initInputMode } from "@platform/theme";
import "@platform/theme/brand.fonts.css";
import "@platform/theme/tokens.css";

async function bootstrap() {
  // UI-работа без бэкенда: `VITE_MOCK=1 pnpm dev` — мок /auth и /me/* (см. dev/mock.ts).
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === "1") {
    const { installMockApi } = await import("./dev/mock.ts");
    installMockApi();
  }
  // ДО первого рендера (tv.10foot.md §9) — режим ввода уже актуален, когда монтируется первый
  // экран (автофокус на Доме, home.visual.md §10, зависит от режима на момент монтирования).
  initInputMode();
  initUmamiTracking();
  createRoot(document.getElementById("app")!).render(
    <StrictMode>
      <DevBanner />
      <App />
    </StrictMode>,
  );
}

void bootstrap();
