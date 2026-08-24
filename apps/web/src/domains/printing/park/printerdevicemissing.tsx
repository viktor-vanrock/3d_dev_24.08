import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { navigate, printersPath } from "../../../router.ts";
import { AuroraBackground, Button, EmptyState } from "@shared/ui";

// Явное состояние голого `/printer/` (MF-1367): маршрут без id не должен маскироваться Домом.
export function PrinterDeviceMissingScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} onBack={() => navigate(printersPath())} />
      </div>
      <main className="homeContent">
        <EmptyState
          icon={<span aria-hidden="true">?</span>}
          title="Принтер не найден"
          sub="В ссылке не указан идентификатор устройства. Откройте принтер из своего парка."
          action={<Button href={printersPath()} variant="secondary">Открыть мой парк</Button>}
        />
      </main>
    </div>
  );
}
