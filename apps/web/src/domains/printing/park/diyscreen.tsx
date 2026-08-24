import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { navigate, printersPath } from "../../../router.ts";
import { AuroraBackground, Button, Card, Heading } from "@shared/ui";
import "./park.css";

// «Сделать самому» (MF-903, docs/design/printer.wizard.md §5.1) — выход из тупика мастера (§3.3,
// когда ни один managed-*/custom не подошёл) и будущая ссылка с карточки неподдерживаемой модели
// (MF-892, backlog). Реальный роут `/printers/:id/diy` — шарибельно/диплинк (product/ux.md §2).
export function DiyScreen({
  user,
  section,
  onSectionChange,
  printerId,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  printerId: string;
}) {
  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader
          user={user}
          printers={[]}
          section={section}
          onSectionChange={onSectionChange}
          onBack={() => navigate(printersPath())}
        />
      </div>
      <main className="homeContent">
        <div className="parkExitPage">
          <Heading size="md">Сделайте сами</Heading>
          <Card className="parkExitPageCard">
            <p className="parkExitIntro">
              Публичный API портала (статус, команды, телеметрия, файлы) работает даже без нашей
              прошивки — поверх любого Moonraker или родного API вашей модели
              {printerId ? <> («{printerId}»)</> : null}.
            </p>
            <ol className="parkDiySteps">
              <li>Прочитать доку публичного API</li>
              <li>Написать свой коннектор под протокол принтера</li>
              <li>Протестировать на своём принтере</li>
            </ol>
            {/* Публичный API (MF-888) на момент MF-903 ещё не выпущен (todo, printer.support.md
                stage 2) — доке открывать некуда. Честно «скоро», не мёртвая ссылка/фейковый URL
                (product/ux.md §6). */}
            <Button variant="secondary" icon={null} disabled>
              Дока API — скоро
            </Button>
          </Card>
        </div>
      </main>
    </div>
  );
}
