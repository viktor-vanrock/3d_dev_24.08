import type { ReactNode } from "react";
import type { DataCapability, SessionUser } from "@shared/types";
import { AuroraBackground } from "@shared/ui";
import { HomeHeader } from "./homeheader.tsx";
import type { Section } from "./types.ts";
import "./datashell.css";

export type DataSection = "materials" | "printers" | "news";

const DATA_SECTIONS: readonly {
  readonly id: DataSection;
  readonly label: string;
  readonly href: string;
  readonly capability: DataCapability;
}[] = [
  { id: "materials", label: "Материалы", href: "/data/materials", capability: "data.materials.manage" },
  { id: "printers", label: "Принтеры", href: "/data/printers", capability: "data.printers.manage" },
  { id: "news", label: "Новости", href: "/data/news", capability: "data.news.manage" },
];

export function DataShell({
  user,
  section,
  onSectionChange,
  active,
  trail,
  children,
}: {
  readonly user: SessionUser;
  readonly section: Section;
  readonly onSectionChange: (section: Section) => void;
  readonly active?: DataSection;
  readonly trail?: string;
  readonly children: ReactNode;
}) {
  const activeSection = DATA_SECTIONS.find((item) => item.id === active);

  return (
    <div className="home dataShell">
      <AuroraBackground />
      <HomeHeader
        user={user}
        printers={[]}
        section={section}
        activeSection={null}
        onSectionChange={onSectionChange}
        mode="full"
      />
      <main className="dataShellContent">
        {activeSection ? <nav className="dataBreadcrumbs" aria-label="Хлебные крошки">
          <a href={`/u/${encodeURIComponent(user.username)}?tab=data`}>Данные</a>
          {activeSection ? <>
            <span aria-hidden="true">/</span>
            <a href={activeSection.href} aria-current={trail ? undefined : "page"}>{activeSection.label}</a>
          </> : null}
          {trail ? (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{trail}</span>
            </>
          ) : null}
        </nav> : null}
        <div className="dataShellBody">{children}</div>
      </main>
    </div>
  );
}
