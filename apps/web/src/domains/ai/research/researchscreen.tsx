import { useEffect, useState } from "react";
import type { SessionUser } from "@shared/types";
import { HomeHeader, type Section, useSectionSwipeNav } from "@platform/nav";
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point -- легатное ребро (Этап 4.5): CSS side-effect, не index.ts; home.css остаётся общим "рабочим хромом" для доменных экранов, развязка отложена до pages/DI (Этап 10). См. MIGRATION.md.
import "@pages/home/home.css";
import { headerModeFor, issueNewPath, navigate, researchPath, type ResearchScope } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { AuroraBackground, Button, EmptyState, Eyebrow, SegmentToggle } from "@shared/ui";
import { listResearchQueue, type ResearchQueueItem } from "./api.ts";
import { ResearchQueueRow, ResearchRowSkeleton } from "./researchrow.tsx";
import { ResearchSearchCreate } from "./researchsearch.tsx";
import "./research.css";

// Очередь работ ресёрчера (MF-916, docs/design/research.workbench.md §0–1). Экран за гейтом роли
// `researcher` — три состояния §0: гость закрыт раньше, на уровне AuthGate (app.tsx уже не
// рендерит ни один экран без сессии, см. auth/authgate.tsx), поэтому здесь реально достижимы
// только «роль есть»/«роли нет» — гость ниже обработан defensively на случай, если гейт когда-то
// подвинется, но живого пути к нему сегодня нет.

const SEGMENTS: { value: ResearchScope; label: string }[] = [
  { value: "mine", label: "Мои" },
  { value: "brand", label: "Мой бренд" },
  { value: "gaps", label: "С пробелами" },
  { value: "low_confidence", label: "Низкая уверенность" },
  { value: "flagged", label: "Помечено пользователями" },
  { value: "all", label: "Все" },
];

const VISITED_KEY = "research.queue.visited";

type QueueState = { status: "loading" } | { status: "ready"; items: ResearchQueueItem[] } | { status: "error" };

export function ResearchScreen({
  user,
  section,
  onSectionChange,
  scope: routeScope,
}: {
  user: SessionUser;
  section: Section;
  onSectionChange: (section: Section) => void;
  scope?: ResearchScope;
}) {
  const swipe = useSectionSwipeNav(section, onSectionChange);
  const sound = useInteractionSound();
  // Роль — прямо из сессии (`GET /auth/session`, MF-917), синхронно с первого рендера: не нужен
  // отдельный `GET /me/role` и его состояние загрузки, `AuthGate` уже отдаёт нам полный `user`.
  const isResearcher = user.role === "researcher";

  // Дефолт сегмента при первом входе (§1.2): «Мой бренд» — бэкенд ещё не привязывает бренд к
  // ресёрчеру (нет колонки/эндпоинта, MF-839 п.3 воркстрим), поэтому дефолт всегда «С пробелами»
  // до появления этой привязки; переключение сегмента вручную работает уже сейчас.
  const defaultScope: ResearchScope = "gaps";
  const scope = routeScope ?? defaultScope;

  const [queue, setQueue] = useState<QueueState>({ status: "loading" });
  const [firstVisit, setFirstVisit] = useState(false);

  useEffect(() => {
    if (!isResearcher) return;
    try {
      setFirstVisit(localStorage.getItem(VISITED_KEY) === null);
      localStorage.setItem(VISITED_KEY, "1");
    } catch {
      // приватный режим/квота — подсказка первого визита не критична, молча пропускаем
    }
  }, [isResearcher]);

  useEffect(() => {
    if (!isResearcher) return;
    const controller = new AbortController();
    setQueue({ status: "loading" });
    listResearchQueue(scope, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setQueue(items ? { status: "ready", items } : { status: "error" });
    });
    return () => controller.abort();
  }, [scope, isResearcher]);

  return (
    <div className="home">
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 30 }}>
        <HomeHeader user={user} printers={[]} section={section} onSectionChange={onSectionChange} mode={headerModeFor("research")} />
      </div>
      <main
        className="homeContent researchBody"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        {!isResearcher ? (
          <EmptyState
            icon={<ResearcherIcon />}
            title="Это рабочее место команды Ресёрчеров"
            sub="Здесь заполняют базу принтеров — характеристики, фото, источники."
            action={
              <Button
                variant="primary"
                onPointerDown={sound.tick}
                onClick={() => navigate(issueNewPath({ title: "Хочу заполнять каталог принтеров", category: "researcher-access" }))}
              >
                Хочу заполнять каталог
              </Button>
            }
          />
        ) : (
          <>
            <div className="researchHeaderRow">
              <Eyebrow>Ресёрчеры</Eyebrow>
              <ResearchSearchCreate />
            </div>

            <div className="researchSegmentsScroll">
              <SegmentToggle
                ariaLabel="Сегмент очереди"
                options={SEGMENTS}
                value={scope}
                onChange={(next) => navigate(researchPath(next))}
                onPress={sound.toggle}
              />
            </div>

            {queue.status === "loading" ? (
              <div className="researchRowList">
                {Array.from({ length: 5 }, (_, i) => (
                  <ResearchRowSkeleton key={i} />
                ))}
              </div>
            ) : queue.status === "error" ? (
              <div className="researchLoadError">
                Очередь не отвечает.{" "}
                <button type="button" className="researchRetry" onClick={() => setQueue({ status: "loading" })}>
                  Обновить
                </button>
              </div>
            ) : queue.items.length === 0 ? (
              <EmptyState
                icon={<CheckIcon />}
                title="Пробелов по вашему бренду нет"
                action={
                  <Button variant="secondary" onPointerDown={sound.tick} onClick={() => navigate("/printers/releases")}>
                    Проверить анонсы
                  </Button>
                }
              />
            ) : (
              <>
                {firstVisit ? <div className="researchHint">Начните с пробелов вашего бренда →</div> : null}
                <div className="researchRowList">
                  {queue.items.map((item) => (
                    <ResearchQueueRow key={item.slug} item={item} onPress={sound.tick} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ResearcherIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 11h6M11 8v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
