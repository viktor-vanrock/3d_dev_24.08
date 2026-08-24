import type { SessionUser } from "./session.ts";
import { HomeHeader, type Section } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { MarkdownBody, AuroraBackground, Heading } from "@shared/ui";
import { headerModeFor, type LegalSlug } from "../../router.ts";
import { LEGAL_PAGES } from "./legalcontent.ts";
import "./legal.css";

export function LegalScreen({
  user,
  section,
  onSectionChange,
  slug,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  slug: LegalSlug;
}) {
  const page = LEGAL_PAGES[slug];

  return (
    <div className="home legalPage">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("legal")} />
      </div>
      <main className="legalPage__content">
        <Heading size="md">
          <a className="legalPage__titleLink" href="/">{page.title}</a>
        </Heading>
        <div className="legalPage__draft" role="note">
          Черновая редакция — документ готовится к утверждению оператором. Актуальная версия будет опубликована здесь.
        </div>
        <MarkdownBody source={page.body} />
      </main>
    </div>
  );
}
