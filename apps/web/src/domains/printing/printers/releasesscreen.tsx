import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { headerModeFor, navigate, printersPath } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, SegmentToggle, EmptyState } from "@shared/ui";
import "./printers.css";
import { PrinterReleaseCard } from "./releasecard.tsx";
import { listReleasesFixture, type PrinterRelease } from "./releasefixtures.ts";

// `/printers/releases` — календарь новинок (MF-833, docs/design/printers.md §2). Тот же
// `wide`-контейнер и шапка раздела, что `/printers` (headerModeFor), сайдбар фильтров не
// переносится (§2: календарь не фильтруется по фасетам каталога) — одна колонка вместо
// сайдбар+сетка, тот же `.homeContent` скелет, что уже использует `/printers/compare`
// (comparescreen.tsx) для единственной колонки полноширинной страницы.

const MONTH_FORMATTER = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

interface MonthGroup {
  key: string;
  label: string;
  monthStart: number;
  releases: PrinterRelease[];
}

export function PrinterReleasesScreen({
  user,
  section,
  onSectionChange,
}: {
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
}) {
  const swipe = useSectionSwipeNav(section, onSectionChange);
  const sound = useInteractionSound();
  const [releases, setReleases] = useState<PrinterRelease[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);
  const nowMs = useMemo(() => Date.now(), []);

  useEffect(() => {
    let cancelled = false;
    listReleasesFixture()
      .then((data) => {
        if (!cancelled) setReleases(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupByMonth(releases ?? []), [releases]);
  const currentMonthStart = useMemo(() => startOfMonth(nowMs), [nowMs]);
  const futureGroups = groups.filter((g) => g.monthStart >= currentMonthStart);
  const pastGroups = groups.filter((g) => g.monthStart < currentMonthStart);
  const nearestFuture = futureGroups[0] ?? null;

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("printer-releases")} />
      </div>
      <main
        className="homeContent"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <div className="prnToggleRow">
          <SegmentToggle
            ariaLabel="Каталог или новинки"
            value="new"
            onChange={(next) => {
              sound.toggle();
              if (next === "catalog") navigate(printersPath());
            }}
            options={[
              { value: "catalog", label: "Каталог" },
              { value: "new", label: "Новинки" },
            ]}
          />
        </div>

        {loadError ? <div className="prnLoadError">Календарь не отвечает. Обновить</div> : null}

        {releases === null ? (
          <ReleasesSkeleton />
        ) : releases.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="В календаре пока нет анонсов" />
        ) : futureGroups.length === 0 ? (
          <EmptyState icon={<CalendarIcon />} title="Пока без ближайших новинок" sub="Загляните позже — агенты следят за анонсами каждый день." />
        ) : (
          <div className="prnReleasesList">
            {/* Открывается на ближайшем будущем месяце (§2): пустые месяцы не рисуются, только
                строка «Ближайшее — в {месяц}» если весь ближайший диапазон пуст — здесь он не
                пуст (futureGroups.length>0), поэтому просто рендерим месяцы по порядку. */}
            {nearestFuture ? (
              <div className="prnReleaseNearest">
                {futureGroups.map((group) => (
                  <MonthSection key={group.key} group={group} user={user} />
                ))}
              </div>
            ) : null}

            {pastGroups.length > 0 ? (
              <div>
                <button
                  type="button"
                  className="prnReleasePast pressable"
                  onClick={() => setPastExpanded((v) => !v)}
                  aria-expanded={pastExpanded}
                  aria-controls="past-printer-releases"
                >
                  <span>{pastExpanded ? `Скрыть остальные (${pastGroups.reduce((n, g) => n + g.releases.length, 0)})` : `Показать остальные (${pastGroups.reduce((n, g) => n + g.releases.length, 0)})`}</span>
                  <DisclosureChevron open={pastExpanded} />
                </button>
                {pastExpanded ? (
                  <div id="past-printer-releases" className="prnReleaseNearest reveal" aria-label="Прошлые релизы">
                    {pastGroups.map((group) => (
                      <MonthSection key={group.key} group={group} user={user} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg className="prnReleasePastChevron" data-open={open || undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MonthSection({ group, user }: { group: MonthGroup; user: SessionUser | null }) {
  return (
    <div className="prnReleaseMonth">
      <div className="uiEyebrow">{group.label}</div>
      <div className="prnReleaseMonthCards">
        {group.releases.map((release, index) => (
          <PrinterReleaseCard key={release.id} release={release} composition="full" user={user} index={index} />
        ))}
      </div>
    </div>
  );
}

function ReleasesSkeleton() {
  return (
    <div className="prnReleaseNearest" aria-hidden="true">
      <div className="uiEyebrow">&nbsp;</div>
      <div className="prnSkeletonLines">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="prnSkeletonLine" style={{ width: "100%", height: 60 }} />
        ))}
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function groupByMonth(releases: PrinterRelease[]): MonthGroup[] {
  const byMonth = new Map<string, PrinterRelease[]>();
  for (const release of releases) {
    const date = new Date(`${release.date}T00:00:00`);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const list = byMonth.get(key) ?? [];
    list.push(release);
    byMonth.set(key, list);
  }
  const groups: MonthGroup[] = Array.from(byMonth.entries()).map(([key, list]) => {
    const parts = key.split("-").map(Number);
    const year = parts[0] ?? 1970;
    const month = parts[1] ?? 1;
    const monthStart = new Date(year, month - 1, 1).getTime();
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    return {
      key,
      label: capitalize(MONTH_FORMATTER.format(new Date(year, month - 1, 1))),
      monthStart,
      releases: sorted,
    };
  });
  return groups.sort((a, b) => a.monthStart - b.monthStart);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
