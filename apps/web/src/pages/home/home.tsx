import { useEffect, useRef, type MouseEvent } from "react";
import type { SessionUser } from "@domains/access";
import { useOverlay } from "@platform/overlay";
import { headerModeFor, navigate, parkAddPath } from "../../router.ts";
import { AuroraBackground, Button, PrinterIcon } from "@shared/ui";
import { resolveTier, useActivation, trackActivation, type ActivationState } from "@shared/lib";
import { useActiveCoachmark, FirstRunFlow } from "@domains/onboarding";
import { HomeHeader, type Section, useSectionSwipeNav, useHomeDpadNav } from "@platform/nav";
import { HeroSearch, useHomeSearch } from "./home.search.tsx";
import { Showcase } from "./home.showcase.tsx";
import { useConceptFlow } from "./conceptflow.ts";
import { useInferredPersona } from "./inferpersona.ts";
import { isDpadModeNow } from "@platform/theme";
import "./home.css";

/*
  Главный экран после входа (эпик MF-789/MF-803, MF-2067/MF-2068). Ровно два блока
  (frame.md §1): HeroSearch — единый запрос; Showcase — полки без запроса либо смешанная
  сетка реальных проектов и постоянных generated concepts.
  PersonaCtaRow/ContinueCard/CompatModule/ActivationChecklist сняты с главной (адреса переезда —
  home.visual.md §8): «Мои модели»/«Мои генерации» — в капсуле (homeheader.tsx), совместимость —
  в разделе «Принтеры»/каталоге, чек-лист/first-run флоу (MF-437) — свой wizard, этой карточки не
  касается (FirstRunFlow ниже как была).
*/

export function HomeScreen({
  user,
  section,
  onSectionChange,
  renderHeader = true,
  activationState,
}: {
  // Гость видит главную без входа (MF-850/MF-912): каталог и ready concept-cache публичны;
  // создание новых GPU-job и TRELLIS остаётся под входом. First-run/чек-лист — только для
  // вошедшего (activation API молча отдаёт guest-фолбэк, activation.ts).
  user: SessionUser | null;
  section: Section;
  onSectionChange: (section: Section) => void;
  renderHeader?: boolean;
  activationState?: ActivationState;
}) {
  const localActivation = useActivation(!activationState);
  const activation = activationState ?? localActivation;
  const tier = resolveTier(activation.activation, activation.printers);
  const isFirstRun = activation.activation?.state === "first_run";
  const overlay = useOverlay();
  // Свайп между разделами (touch.nav.md §2) — второй вход к тем же NAV_ITEMS, что таббар/пилюля.
  // Полки скроллятся горизонтально сами (.homeGallery, home.visual.md §3) — приоритет жеста
  // внутри них, тот же паттерн, что уже даёт HeroCarouselView каталогу.
  const swipe = useSectionSwipeNav(section, onSectionChange, ".heroCarousel, .homeGallery");

  // Достраивает персону по поведению, когда declared нет/размыта (Фаза 3, MF-438 §
  // «Inferred-персона») — молча патчит профиль, ничего не рендерит само.
  useInferredPersona(activation);

  // Единственная коучмарка Дома (home.visual.md §6) — теперь видна на любом входе, не только
  // returning; дисмисс — четыре триггера, три из них (символ/таймер/скролл) проводятся в
  // HeroSearch, «Понятно» — прямо здесь через Coachmark.
  const activeCoachmark = useActiveCoachmark(activation);

  const search = useHomeSearch();
  const conceptFlow = useConceptFlow(user, search.query, search.promptState, search.cacheState);

  // Пульт/D-pad (tv.10foot.md §9, home.visual.md §10, MF-923): режим уже известен ДО монтирования
  // (initInputMode() в main.tsx стартует раньше первого рендера) — автофокус на первую плитку
  // применяем только если вход уже был пультом, обычный тач/мышь-вход не трогаем.
  const dpadEntry = useRef(isDpadModeNow());
  useHomeDpadNav(dpadEntry.current);

  // События воронки активации (MF-438 § «События активации в MF-41»): старт first-run и
  // переход в returning — оба наблюдаемы только на уровне дома (никакой другой компонент не
  // видит смену activation.state целиком), поэтому логируются здесь, а не в firstrun.tsx.
  const firstRunStartLogged = useRef(false);
  const homeViewLogged = useRef(false);
  const previousStateRef = useRef<string | null>(null);
  useEffect(() => {
    if (activation.loading || !activation.activation) return;
    const state = activation.activation.state;
    if (!homeViewLogged.current) {
      homeViewLogged.current = true;
      trackActivation("home_view", { state });
    }
    if (state === "first_run" && !firstRunStartLogged.current) {
      firstRunStartLogged.current = true;
      trackActivation("first_run_start");
    }
    if (previousStateRef.current && previousStateRef.current !== state && state === "returning") {
      trackActivation("state_changed", { to: "returning" });
    }
    previousStateRef.current = state;
  }, [activation.loading, activation.activation]);

  // Группа «система» центра уведомлений (MF-443 §6) — из реального состояния активации
  // (не хардкод, как раньше NotificationRow в homeheader.tsx). notify() сам дедупит по
  // id, так что звать на каждом рендере безопасно — заново не звенит и не дублирует.
  useEffect(() => {
    if (activation.loading || !activation.activation) return;
    if (activation.activation.state === "first_run") {
      overlay.notifications.notify({
        id: "system-welcome",
        group: "system",
        severity: "success",
        title: "Добро пожаловать на 3mf.tech",
        message: "Аккаунт создан, всё готово",
      });
    }
    if (!activation.activation.has_printer) {
      overlay.notifications.notify({
        id: "system-no-printer",
        group: "system",
        severity: "warn",
        title: "Привяжите принтер",
        message: "Откроем совместимость моделей с вашим парком",
      });
    }
  }, [activation.loading, activation.activation, overlay.notifications]);

  return (
    <div className="home" data-tier={tier}>
      <AuroraBackground />
      {/* zIndex 30: шапка и её всплывашки всегда над контентом (иначе homeContent,
          такой же stacking-context ниже по DOM, перехватывает клики по попову) */}
      {renderHeader ? (
        <div style={{ position: "relative", zIndex: 30 }}>
          <HomeHeader
            user={user}
            printers={activation.printers}
            section={section}
            onSectionChange={onSectionChange}
            mode={headerModeFor("home")}
          />
        </div>
      ) : null}
      {activation.loading || !activation.activation || isFirstRun || activation.activation.has_printer ? null : <PrinterConnectFab />}
      <main
        className="homeContent"
        style={swipe.dragX !== 0 ? { transform: `translateX(${swipe.dragX}px)` } : undefined}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerUp}
        onPointerCancel={swipe.onPointerCancel}
      >
        <HeroSearch
          query={search.query}
          onQueryChange={search.setQuery}
          coachmark={activeCoachmark}
        />
        {activation.loading ? null : (
          <Showcase
            query={search.query}
            searchState={search.searchState}
            onRetry={search.retry}
            conceptFlow={conceptFlow}
          />
        )}
        {/* first-run онбординг (MF-437) — отдельный wizard (персона → принтер → филамент/soft-track
            → чек-лист), не задет этой карточкой (MF-918 её не переписывает). Гостю не бывает:
            isFirstRun требует activation.activation, а тот null без сессии (activation.ts). */}
        {activation.loading || !isFirstRun || !user ? null : <FirstRunFlow user={user} activation={activation} />}
      </main>
    </div>
  );
}

// Единственная точка подключения принтера на главной (MF-1726): расширенный FAB остаётся
// понятным без hover благодаря постоянным тексту и глифу. Нейтральное стекло не спорит с
// зелёной искрой генерации — важность сообщает плавающее положение и высота, а не второй
// primary-цвет. Ссылка сохраняет нативную keyboard/screen-reader семантику и рабочий href.
function PrinterConnectFab() {
  const path = parkAddPath();

  function handleNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(path);
  }

  return (
    <Button className="homePrinterFab" href={path} variant="secondary" icon={<PrinterIcon size={22} />} onClick={handleNavigation}>
      Подключить принтер
    </Button>
  );
}
