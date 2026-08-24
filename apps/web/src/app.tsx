import { lazy, Suspense, type ReactNode } from "react";
import { AuthGate, GuestIntentResumer, useSession, type SessionUser, LegalScreen, isClosedDev } from "@domains/access";
import { Footer } from "./footer/footer.tsx";
import { CommunitiesScreen, CommunityScreen, ModerationScreen, ThreadScreen, FeedEditorScreen, FeedScreen, FeedPostScreen, IdeaScreen, IssueFeedScreen, isWideProjectsEnabled, ProjectsPage } from "@domains/social";
import { ConsentBanner } from "@platform/consent";
import { GenerateScreen, ResearchFormScreen, ResearchScreen, AssistantChatCenter, AssistantChatsScreen, AssistantWorkshopScreen } from "@domains/ai";
import { HomeScreen } from "./pages/home/home.tsx";
import { HomeHeader, type Section, BottomTabBar, NAV_ITEMS } from "@platform/nav";
import { useActivation } from "@shared/lib";
import { AddModelPage, MakesGalleryScreen, MakeDetailScreen, MarketplaceScreen, ModelScreen, ProjectBuildScreen, ProjectStudioScreen, ProfileScreen, PurchaseReturnScreen } from "@domains/commerce";
import { OverlayProvider } from "@platform/overlay";
import { CatalogMetricsPage } from "./pages/catalogmetrics.tsx";
import { IdeaSubmitScreen } from "./pages/ideasubmit.tsx";
import { KitchenSinkPage } from "./pages/kitchensink.tsx";
import { LoginPage } from "./pages/login.tsx";
import { MaterialCandidatesPage } from "./pages/materialcandidates.tsx";
import { MaterialDetailScreen, MaterialsScreen, ParkAddScreen, CommunityFirmwareScreen, DiyScreen, ParkScreen, SlicePrintScreen, PlateScreen, PrinterLiveScreen, PrinterDeviceMissingScreen, PrinterFaceScreen, PrinterCompareScreen, PrinterDetailScreen, PrintersScreen, PrinterReleasesScreen } from "@domains/printing";
import { ProductHealthPage } from "./pages/producthealth.tsx";
import { InstallBanner, PwaRuntime } from "@platform/pwa";
import { feedPath, filamentsPath, headerModeFor, issuesPath, marketPath, navigateWithTransition, printersPath, useRoute } from "./router.ts";
import { ThemeProvider } from "@platform/theme";
import { AuroraBackground } from "@shared/ui";

// Мастерская персонажа — отдельный route-chunk. Каталог/SVG появляются после маленького
// чанка страницы, сам three.js подгружается уже после первого paint внутри экрана.
const AvatarEditorPage = lazy(() =>
  import("./pages/home/avatareditor.tsx").then((module) => ({ default: module.AvatarEditorPage })),
);

// Гейт (MF-14) → главный экран-дом (MF-435) / витрина «Проекты» (MF-463). OverlayProvider
// (MF-441) — рядом с ThemeProvider, один на всё приложение. Раздел (таб «Дом»/«Проекты»)
// выводится из path-роута (router.ts): `/` — дом, `/project` — витрина. `/kitchen-sink`
// (MF-426) — стенд-витрина ui/, без auth-гейта: рендерится до AuthGate, чтобы библиотеку
// компонентов можно было сверить без PlagID-логина.
// `/project` за флагом wide (MF-524/MF-512): по умолчанию — новая страница «Проекты» (wide-шапка +
// hero + живой поиск/каталог, docs/design/projects.page.md); `?wide=0`/`VITE_PROJECTS_WIDE=0` —
// откат на старую витрину (MarketplaceScreen), пока не все слайсы домержены.
//
// Публичные роуты без логина (MF-850/MF-912, решение CTO по MF-831): гость читает
// home/market/model/feed — `user` в этой ветке `SessionUser | null`, экраны сами решают гостевой
// рендер. `printers`/`printer`/`printer-compare` (MF-927, printers.catalog.md §7 «Гость: читает
// каталог/карточку свободно») — тоже гостевые: экран сегодня работает на фикстуре (MF-927 п.
// «Известный блокер»), обращения к гейтованному API нет, действия под auth (сравнение живёт в
// URL и без логина, «Это мой принтер»/«Уведомить о выходе» — по тапу промпт входа) решает сам
// экран. Всё остальное (add/makes/profile/generate/catalog-metrics/research/
// feed-post/feed-new) — как раньше, LoginPage вместо экрана; ниже, в этой ветке, `user`
// гарантированно не null (гость не проходит проверку выше), `protectedUser` — просто каст,
// отражающий этот инвариант, не новая проверка.
// "issue"/"idea" — лента идей и карточка идеи (MF-945, ideas.md §1.6/§3: «лента и чтение
// идей гостю доступны, публичный канал» — подача/голос под auth, экран сам решает гостевой
// рендер/soft-gate 401). "issue-new" (MF-947) не в списке — форма подачи требует логина целиком
// (тот же приём, что park-add/printer-diy), гость видит LoginPage.
const GUEST_ALLOWED_SCREENS = new Set([
  "home",
  "market",
  "model",
  "profile",
  "feed",
  "printers",
  "printer",
  "printer-compare",
  "printer-releases",
  "materials",
  "material",
  "printer-device-missing",
  "issue",
  "idea",
  "park-add",
  "legal",
]);
export function App() {
  const route = useRoute();
  const session = useSession();
  const user = session.status === "authenticated" ? session.user : null;
  const wideProjectsEnabled = isWideProjectsEnabled();
  const keepsSectionChrome =
    route.screen === "home" ||
    route.screen === "feed" ||
    route.screen === "printers" ||
    route.screen === "materials" ||
    (route.screen === "market" && wideProjectsEnabled);
  // Состояние парка загружается один раз на уровне приложения и питает постоянную шапку.
  // Смена Дом → Новости → Проекты → Принтеры → Материалы больше не уничтожает пользовательский chrome
  // (включая WebGL-персонажа) вместе с payload конкретной страницы.
  const shellActivation = useActivation(keepsSectionChrome);
  // Раздел для подсветки нав-ряда (NAV_ITEMS — единый реестр, header-capsule.md): экраны без
  // своего пункта меню подсвечивают ближайший смысловой раздел — /generate подсвечивает "home"
  // (вход в генератор — строка поиска Дома), страницы поста/редактора ленты — "feed". Форум
  // (communities/community/thread) пока без своего пункта меню (MF-931) — тоже "home", а не
  // "market": сообщество не часть раздела «Проекты».
  const section: Section =
    route.screen === "home" || route.screen === "generate" || route.screen === "assistant-chats" || route.screen === "assistant-workshop" || route.screen === "avatar-editor" || route.screen === "communities" || route.screen === "community" || route.screen === "thread" || route.screen === "moderation"
      ? "home"
      : route.screen === "feed" || route.screen === "feed-post" || route.screen === "feed-new"
        ? "feed"
        : route.screen === "printers" ||
            route.screen === "printer" ||
            route.screen === "printer-compare" ||
            route.screen === "printer-releases" ||
            route.screen === "printer-device" ||
            route.screen === "printer-device-missing" ||
            route.screen === "park" ||
            route.screen === "printer-diy" ||
            route.screen === "printer-community-firmware" ||
            route.screen === "research" ||
            route.screen === "research-form"
          ? "printers"
          : route.screen === "materials" || route.screen === "material"
            ? "materials"
          : route.screen === "issue" || route.screen === "idea" || route.screen === "issue-new"
            ? "issue"
            : "market";
  // Профиль — самостоятельный пользовательский слой, а не подраздел «Проектов».
  // Контекстный `section` сохраняем для вычисления направления следующего перехода,
  // но визуально ни верхняя, ни нижняя глобальная навигация не притворяются активными.
  const activeGlobalSection: Section | null =
    route.screen === "profile" || route.screen === "own-profile" ? null : section;

  // Пилюля-переход (motion.md §2): направление — по порядку NAV_ITEMS (реестр табов), не
  // хардкод «home/market» — новый раздел добавляется там же и авто-подхватывает fwd/back.
  function onSectionChange(next: Section): void {
    const fromIndex = NAV_ITEMS.findIndex((item) => item.section === section);
    const toIndex = NAV_ITEMS.findIndex((item) => item.section === next);
    const direction = toIndex >= fromIndex ? "fwd" : "back";
    const path =
      next === "home"
        ? "/"
        : next === "feed"
          ? feedPath()
          : next === "market"
            ? marketPath()
            : next === "printers"
              ? printersPath()
              : next === "materials"
                ? filamentsPath()
                : issuesPath();
    navigateWithTransition(path, direction);
  }

  if (route.screen === "kitchen-sink") {
    return (
      <PageFrame>
        <KitchenSinkPage />
      </PageFrame>
    );
  }

  // Морда принтера (MF-926, printer.face.md §2) — отдельный артефакт вне IA портала (§2.1),
  // рендерится до AuthGate тем же приёмом, что kitchen-sink: MVP на моках, устройство само себя
  // авторизует отдельно от портал-аккаунта (сцена f — это как раз привязка, не вход в apps/web).
  // OverlayProvider — свой (confirm/toast/alert внутри сцен), BottomTabBar/HomeHeader нет.
  if (route.screen === "printer-face") {
    return (
      <PageFrame>
        <PrinterFaceScreen />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
        <PwaRuntime />
        <ConsentBanner />
        <GuestIntentResumer user={user} />
        <AuthGate session={session}>
          {(user) => {
            // `/park/add` — самостоятельный диплинк с soft-gate на защищённых уровнях мастера.
            // Даже при CLOSED_DEV гость должен попасть в этот маршрут: иначе вместо login-overlay
            // получает полноэкранную LoginPage и теряет printer_id/return_to из deep-link.
            const canOpenGuestParkAdd = route.screen === "park-add";
            if (user === null && !canOpenGuestParkAdd && (isClosedDev() || !GUEST_ALLOWED_SCREENS.has(route.screen))) {
              return <LoginPage />;
            }

            if (route.screen === "catalog-metrics") {
              return <CatalogMetricsPage />;
            }
            // Апрув-очередь material_candidates (MF-848) — внутренний инструмент, тот же приём,
            // что catalog-metrics выше: рендерится до BottomTabBar, вне табов IA.
            if (route.screen === "material-candidates") {
              return <MaterialCandidatesPage />;
            }
            // Дашборд здоровья продукта (MF-733) — тот же приём, что catalog-metrics выше.
            if (route.screen === "product-health") {
              return <ProductHealthPage />;
            }
            // Мастер «добавить принтер» — отдельный маршрут без нижней навигации, но с общей
            // верхней оболочкой и возвратом, чтобы не менять геометрию шапки между страницами.
            if (route.screen === "park-add") {
              return <ParkAddScreen user={user} section={section} onSectionChange={onSectionChange} />;
            }
            if (route.screen === "slice-print") return <SlicePrintScreen user={user as SessionUser} section={section} onSectionChange={onSectionChange} sliceId={route.sliceId} />;
            // Плита стола (MF-1094) — своя мини-шапка, тот же приём, что slice-print выше.
            if (route.screen === "plate") return (
              <PlateScreen
                user={user as SessionUser}
                section={section}
                onSectionChange={onSectionChange}
                modelId={route.modelId}
                artifactId={route.artifactId}
                stepId={route.stepId}
              />
            );
            // Форма подачи идеи (MF-947, docs/design/ideas.md §4) — своя мини-шапка (light,
            // «← Назад»), не раздел IA: тот же приём, что park-add выше, без BottomTabBar.
            if (route.screen === "issue-new") {
              return <IdeaSubmitScreen user={user as SessionUser} />;
            }
            // Приватная 3D-мастерская — иммерсивный экран без глобальных tabbar/footer/FAB:
            // сцена и чат сами являются навигационной оболочкой этого режима.
            if (route.screen === "assistant-workshop") {
              return <AssistantWorkshopScreen user={user as SessionUser} threadId={route.threadId} />;
            }
            if (route.screen === "avatar-editor") {
              return (
                <Suspense fallback={<div className="avatarStudioLoading">Открываем мастерскую…</div>}>
                  <AvatarEditorPage user={user as SessionUser} section={section} onSectionChange={onSectionChange} />
                </Suspense>
              );
            }
            const protectedUser = user as SessionUser;
            let screen: ReactNode;
            if (route.screen === "add") {
              screen = <AddModelPage user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "makes") {
              screen = <MakesGalleryScreen user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "make") {
              screen = <MakeDetailScreen id={route.id} />;
            } else if (route.screen === "model") {
              screen = <ModelScreen user={user} section={section} onSectionChange={onSectionChange} id={route.id} tab={route.tab} />;
            } else if (route.screen === "project-build") {
              screen = (
                <ProjectBuildScreen
                  user={protectedUser}
                  section={section}
                  onSectionChange={onSectionChange}
                  id={route.id}
                  configId={route.config}
                />
              );
            } else if (route.screen === "project-studio") {
              screen = (
                <ProjectStudioScreen
                  user={protectedUser}
                  section={section}
                  onSectionChange={onSectionChange}
                  id={route.id}
                  initialView={route.view}
                  source={route.source}
                />
              );
            } else if (route.screen === "profile") {
              screen = <ProfileScreen user={user} section={section} onSectionChange={onSectionChange} username={route.username} />;
            } else if (route.screen === "purchase-return") {
              screen = <PurchaseReturnScreen id={route.id} />;
            } else if (route.screen === "own-profile") {
              screen = <ProfileScreen user={protectedUser} section={section} onSectionChange={onSectionChange} username={protectedUser.username} />;
            } else if (route.screen === "legal") {
              screen = <LegalScreen user={user} section={section} onSectionChange={onSectionChange} slug={route.slug} />;
            } else if (route.screen === "generate") {
              screen = <GenerateScreen user={protectedUser} section={section} onSectionChange={onSectionChange} genId={route.genId} />;
            } else if (route.screen === "assistant-chats") {
              screen = <AssistantChatsScreen user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "feed") {
              screen = <FeedScreen user={user} section={section} onSectionChange={onSectionChange} scope={route.scope} community={route.community} renderHeader={false} />;
            } else if (route.screen === "feed-post") {
              screen = <FeedPostScreen user={protectedUser} section={section} onSectionChange={onSectionChange} id={route.id} />;
            } else if (route.screen === "feed-new") {
              screen = <FeedEditorScreen user={protectedUser} section={section} onSectionChange={onSectionChange} modelId={route.model} />;
            } else if (route.screen === "printers") {
              screen = <PrintersScreen user={user} section={section} onSectionChange={onSectionChange} view={route.view} renderHeader={false} activationState={shellActivation} />;
            } else if (route.screen === "printer") {
              screen = <PrinterDetailScreen user={user} section={section} onSectionChange={onSectionChange} slug={route.slug} />;
            } else if (route.screen === "materials") {
              screen = <MaterialsScreen user={user} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "material") {
              screen = <MaterialDetailScreen user={user} section={section} onSectionChange={onSectionChange} id={route.id} />;
            } else if (route.screen === "printer-device") {
              screen = <PrinterLiveScreen user={protectedUser} section={section} onSectionChange={onSectionChange} id={route.id} />;
            } else if (route.screen === "printer-device-missing") {
              screen = <PrinterDeviceMissingScreen user={user} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "park") {
              screen = <ParkScreen user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "printer-compare") {
              screen = <PrinterCompareScreen user={user} section={section} onSectionChange={onSectionChange} ids={route.ids} />;
            } else if (route.screen === "printer-releases") {
              screen = <PrinterReleasesScreen user={user} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "printer-diy") {
              screen = <DiyScreen user={protectedUser} section={section} onSectionChange={onSectionChange} printerId={route.printerId} />;
            } else if (route.screen === "printer-community-firmware") {
              screen = <CommunityFirmwareScreen user={protectedUser} section={section} onSectionChange={onSectionChange} printerId={route.printerId} />;
            } else if (route.screen === "research") {
              screen = <ResearchScreen user={protectedUser} section={section} onSectionChange={onSectionChange} scope={route.scope} />;
            } else if (route.screen === "research-form") {
              screen = <ResearchFormScreen user={protectedUser} section={section} onSectionChange={onSectionChange} slug={route.slug} draft={route.draft} />;
            } else if (route.screen === "communities") {
              screen = <CommunitiesScreen user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "community") {
              screen = <CommunityScreen user={protectedUser} section={section} onSectionChange={onSectionChange} slug={route.slug} />;
            } else if (route.screen === "thread") {
              screen = <ThreadScreen user={protectedUser} section={section} onSectionChange={onSectionChange} id={route.id} />;
            } else if (route.screen === "moderation") {
              screen = <ModerationScreen user={protectedUser} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "idea") {
              screen = <IdeaScreen user={protectedUser} section={section} onSectionChange={onSectionChange} id={route.id} />;
            } else if (route.screen === "issue") {
              screen = <IssueFeedScreen user={user} section={section} onSectionChange={onSectionChange} />;
            } else if (route.screen === "market") {
              screen = wideProjectsEnabled ? (
                <ProjectsPage user={user} section={section} onSectionChange={onSectionChange} renderHeader={false} activationState={shellActivation} />
              ) : (
                <MarketplaceScreen
                  user={user}
                  section={section}
                  onSectionChange={onSectionChange}
                  initialTag={route.tag}
                  initialQ={route.q}
                  initialSort={route.sort}
                />
              );
            } else {
              screen = <HomeScreen user={user} section={section} onSectionChange={onSectionChange} renderHeader={false} activationState={shellActivation} />;
            }
            // Bottom-tab (touch.nav.md §1) — корневой навигатор, один на все авторизованные
            // экраны раздела; catalog-metrics (обработан выше, до этой точки не доходит) —
            // внутренний инструмент, вне IA разделов, свой bottom-tab ему не нужен.
            return (
              <>
                {keepsSectionChrome ? (
                  <div className="appSectionChrome" data-persistent-shell="true">
                    <HomeHeader
                      user={user}
                      printers={shellActivation.printers}
                      section={section}
                      activeSection={activeGlobalSection}
                      onSectionChange={onSectionChange}
                      mode={headerModeFor(route.screen === "market" ? "market" : route.screen)}
                    />
                  </div>
                ) : null}
                {screen}
                <BottomTabBar
                  section={section}
                  activeSection={activeGlobalSection}
                  onSectionChange={onSectionChange}
                />
                {!user || route.screen === "assistant-chats" ? null : <AssistantChatCenter user={protectedUser} />}
                <InstallBanner />
              </>
            );
          }}
        </AuthGate>
    </PageFrame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <OverlayProvider>
        <div className="appShell">
          <AuroraBackground className="appShellAurora" />
          {children}
          <Footer />
        </div>
      </OverlayProvider>
    </ThemeProvider>
  );
}
