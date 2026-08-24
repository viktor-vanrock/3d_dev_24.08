import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { navigate, printersPath } from "../../../router.ts";
import { AuroraBackground, ActionCard, Card, EmptyState, Heading, StatusPill } from "@shared/ui";
import { fetchCommunityFirmware, type CommunityFirmwareEntry } from "./communityfirmware.ts";
import "./park.css";

function PrinterIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8V4h12v4M6 8H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2m12-8h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 8h12M6 15h12v5H6v-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// «Прошивки сообщества» (MF-903, docs/design/printer.wizard.md §5.2) — выход из тупика мастера и
// будущая ссылка с карточки неподдерживаемой модели (MF-892). Реальный роут
// `/printers/:id/community-firmware`. Бэкенд (community_firmware CRUD, MF-889) ещё не выпущен —
// fetchCommunityFirmware деградирует в пустой список, что честно (реестр только что заведён,
// сабмишенов пока ни у одной модели нет), см. коммент в communityfirmware.ts.
export function CommunityFirmwareScreen({
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
  const [entries, setEntries] = useState<CommunityFirmwareEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCommunityFirmware(printerId).then((rows) => {
      if (!cancelled) {
        setEntries(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [printerId]);

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
          <Heading size="md">Прошивки сообщества</Heading>
          <Card className="parkExitPageCard">
            {loading ? null : entries.length === 0 ? (
              <EmptyState
                icon={<PrinterIcon />}
                title="Пока никто не опубликовал прошивку под эту модель"
                sub="Адаптируете сами? Опубликуйте свой репозиторий на GitVerse — станете первым."
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {entries.map((entry) => (
                  <ActionCard
                    key={entry.id}
                    variant="secondary"
                    title={entry.author}
                    sub={
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusPill tone="dim">не проверено нами</StatusPill>
                      </span>
                    }
                    icon={<ExternalIcon />}
                    href={entry.gitUrl}
                    external
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
