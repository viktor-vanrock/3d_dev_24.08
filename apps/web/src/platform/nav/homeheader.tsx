import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HeaderMode, Section } from "@platform/nav/types.ts";
import type { SessionUser } from "@shared/types";
// Легатное ребро platform→domains. Разрывается на Этапе 10 через pages/<route>/ + DI
// (передача HomeHeader через props из pages вместо прямого import в доменах).
// eslint-disable-next-line boundaries/element-types
import { useGuestLogin, logout } from "@domains/access";
// Легатное ребро platform→domains. Разрывается на Этапе 10 через pages/<route>/ + DI
// (передача HomeHeader через props из pages вместо прямого import в доменах).
// eslint-disable-next-line boundaries/element-types
import { AssistantHeaderSearch } from "@domains/ai";
import { usePrinterAlerts, mockPrinterStatusSource, useOverlay, NotificationCenterList } from "@platform/overlay";
import { avatarEditorPath, generatePath, navigate, profilePath } from "../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { ThemeToggle } from "@platform/theme";
import { CubeIcon, IconButton, PrinterIcon, SegmentToggle } from "@shared/ui";
import { trackActivation, type UserPrinter } from "@shared/lib";
import { AvatarBubble, useAvatar, LiveHeaderMascot } from "@shared/avatar";
import { NAV_ITEMS, navItemEventName } from "./navitems.ts";
// Легатное ребро platform→pages. Разрывается на Этапе 10 через pages/<route>/ + DI
// (передача HomeHeader через props из pages вместо прямого import в доменах).
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point
import { ProfileEditForm } from "@pages/home/profileedit.tsx";

/*
  Шапка (docs/design/header-capsule.md, фидбек 2026-07-04; режим wide — docs/design/projects.page.md §1):
  - СЛЕВА на странице: крупные часы + дата (живой тикер).
  - СПРАВА: таб-пилюли раздела (реестр — navitems.ts) + ЕДИНАЯ КАПСУЛА (паттерн
    Apple-«островка») — стеклянная пилюля, которая поедет по всем страницам. Внутри
    симметричные контролы 40px: [контекстные статусы] · тема · колокол(+бейдж→всплывашка) ·
    аватар(→меню). Контекст страницы добавляет статусы в левый край капсулы (здесь —
    печать по парку).
  Всплывашки капсулы — предвестник эпика MF-440 (там станут примитивом MF-40).

  Режим `mode` (§1.1 projects.page.md) — механизм дизайн-системы, не вторая шапка: `light`
  (дом, по умолчанию) держит часы/капсулу в пределах контента; `wide` («Проекты» и будущие
  листинговые страницы) прижимает их к краям вьюпорта и центрирует нав-табы сверху. Часы,
  капсула, попапы и обработчики — общие для обоих режимов, различается только раскладка-обёртка.
*/

export type { Section, HeaderMode };

export function HomeHeader({
  user,
  printers,
  section,
  activeSection,
  onSectionChange,
  onBack,
  backLabel,
  mode,
}: {
  // Гость (MF-850/MF-912, публичные роуты без логина): без аккаунта показывать нечего —
  // капсула-аватар/попап меняются на компактную «Войти» (промпт входа поверх, guestlogin.tsx),
  // не новый визуал сверх feed.md/home.scenario.md §3.5.
  user: SessionUser | null;
  printers: UserPrinter[];
  section: Section;
  // На самостоятельных слоях приложения (например, публичный профиль) ни один
  // глобальный раздел не активен. Сам `section` всё ещё нужен для направления
  // перехода, а nullable activeSection управляет только визуальной подсветкой.
  activeSection?: Section | null;
  onSectionChange: (section: Section) => void;
  onBack?: () => void;
  // Подпись у кнопки "назад" (feed.post.editor.md §0/§1.1: «← В ленту» на cold-start заходе на
  // страницу поста — редкий случай, когда IconButton носит текст) — по умолчанию кнопка голая.
  backLabel?: string;
  mode?: HeaderMode;
}) {
  // Дом всегда передаёт `presentation` явно. Для остальных экранов безопасный fallback:
  // обычная рабочая шапка, а наличие возврата автоматически выбирает `mixed`. Это не даёт
  // новой странице случайно унаследовать компактную геометрию Дома.
  const resolvedMode: HeaderMode = mode ?? (onBack ? "mixed" : "full");
  // Единый поиск относится к рабочему хрому: в presentation главная уже сама является
  // поисковой сценой, поэтому в шапке он дублировал главный ввод. В full/mixed поле
  // появляется рядом с персонажем и наследует общий route-transition оболочки.
  const showAssistantSearch = resolvedMode === "full" || resolvedMode === "mixed";
  const [open, setOpen] = useState<"none" | "user">("none");
  const [mascotTyping, setMascotTyping] = useState(false);
  // Персонаж-аватар (MF-446): редактор живёт на отдельном /profile/avatar.
  const [avatar, , avatarSnapshots] = useAvatar(user?.id ?? "guest");
  const capsuleRef = useRef<HTMLDivElement>(null);
  const profileViewLogged = useRef(false);
  const overlay = useOverlay();
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();

  // ProfileScreen использует эту общую шапку, поэтому в рамках home-слайса фиксируем маунт
  // ЛК по каноническому профайл-маршруту. Реф защищает от повторных рендеров этого же захода.
  useEffect(() => {
    if (profileViewLogged.current || !window.location.pathname.startsWith("/u/")) return;
    profileViewLogged.current = true;
    trackActivation("profile_view");
  }, []);

  // Переход в/из `back` (motion.md §10.1): часы/нав-пилюля/капсула схлопываются на месте
  // (opacity→0 + scaleY(0.9), --dur-nav/--ease-out), не «едут» и не исчезают мгновенно.
  // `chromeCollapsed` держит три кластера смонтированными на время анимации, затем настоящий
  // back-режим (только стрелка назад, ничего больше не смонтировано) включается таймером — тот
  // же приём и в обратную сторону при выходе. `prefers-reduced-motion` — переключение мгновенно,
  // без промежуточного кадра.
  const [chromeCollapsed, setChromeCollapsed] = useState(resolvedMode === "back");
  const [backSettled, setBackSettled] = useState(resolvedMode === "back");
  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (resolvedMode === "back") {
      if (reduceMotion) {
        setChromeCollapsed(true);
        setBackSettled(true);
        return;
      }
      setChromeCollapsed(true);
      const timer = setTimeout(() => setBackSettled(true), 220);
      return () => clearTimeout(timer);
    }
    setBackSettled(false);
    if (reduceMotion) {
      setChromeCollapsed(false);
      return;
    }
    const raf = requestAnimationFrame(() => setChromeCollapsed(false));
    return () => cancelAnimationFrame(raf);
  }, [resolvedMode]);

  // Алерты печати (MF-442/443): источник за интерфейсом PrinterStatusSource — мок
  // на реальном парке пользователя, т.к. живой телеметрии MF-26 к v1 ещё нет (§8
  // спеки). Пересоздаём мок только когда меняется состав парка, не на каждый рендер.
  const printerIdsKey = printers.map((printer) => printer.id).join(",");
  const printerStatusSource = useMemo(
    () => mockPrinterStatusSource(printers.map((printer) => ({ id: printer.id, name: `${printer.brand} ${printer.model}`.trim() }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printerIdsKey],
  );
  usePrinterAlerts(printerStatusSource);

  // Уплотнение стекла шапки по скроллу (header-capsule.md § «Уплотнение стекла — единственная
  // реакция на скролл») — rAF-throttled, единственный переключатель [data-scrolled] в CSS.
  // Hide-on-scroll запрещён (nav.sections.md §1.1): шапка остаётся на месте всегда, меняется
  // только плотность подложки.
  const [scrolled, setScrolled] = useState(() => typeof window !== "undefined" && window.scrollY > 0);
  useEffect(() => {
    let raf = 0;
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 0);
        raf = 0;
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Правка профиля (MF-355, Фаза 2): модалка с именем/ником; визуальная идентичность
  // редактируется только в конструкторе персонажа (MF-446), без photo/avatar_url. Только
  // для авторизованных — кнопка, которая её вызывает, рендерится исключительно в user-попапе,
  // а тот сам виден только когда user не null (гость его не видит).
  function openProfileEdit() {
    if (!user) return;
    const handle = overlay.modal({
      title: "Профиль",
      content: <ProfileEditForm user={user} overlay={overlay} onClose={() => handle.close()} />,
    });
  }

  // Клик мимо капсулы закрывает всплывашку.
  useEffect(() => {
    if (open === "none") return;
    const close = (event: PointerEvent) => {
      if (!capsuleRef.current?.contains(event.target as Node)) {
        setOpen("none");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const clock = <Clock key="shell-clock" />;

  // Реестр маршрутов (navitems.ts) питает нав-табы в обоих режимах — добавление раздела
  // («Принтеры» и т.п.) не требует правок этого компонента (§1.3 projects.page.md). SegmentToggle
  // (ui/segmenttoggle.tsx) — общий компонент с сортировкой на /project (projectspage.tsx): один
  // скользящий DOM-якорь заливки под shared-element slide (motion.md §2), не два похожих таба.
  // className="homeSectionTabs" — Motion-хук (ui.css): свой тайминг перехода + view-transition-name
  // для моста между Дом/Проекты (разные экраны, полный ремаунт), не задевает сортировку.
  // Переход раздела (motion.md §2, sound.md §3): tick на тап пилюли сразу (onPress), затем
  // тихий nav-свуш через +40ms — синхронно со стартом cross-fade контента, не слитно с tick.
  // Направление — по порядку NAV_ITEMS (тот же реестр, что App.onSectionChange), не хардкод.
  const navTabs = (
    <SegmentToggle<Section>
      key="shell-nav"
      className="homeSectionTabs"
      ariaLabel="Разделы"
      options={NAV_ITEMS.map((item) => ({ value: item.section, label: item.label }))}
      value={activeSection === undefined ? section : activeSection}
      onChange={(next) => {
        const item = navItemEventName(next);
        if (item) trackActivation("nav_item_click", { item });
        onSectionChange(next);
      }}
      onPress={(next) => {
        sound.tick();
        const fromIndex = NAV_ITEMS.findIndex((item) => item.section === section);
        const toIndex = NAV_ITEMS.findIndex((item) => item.section === next);
        const direction = toIndex >= fromIndex ? "fwd" : "back";
        setTimeout(() => sound.nav(direction), 40);
      }}
    />
  );

  // Капсула-«островок» — тот же примитив в обоих режимах (header-capsule.md): режим меняет
  // только точку привязки края (см. .homeTopbar[data-shell] в home.css), не внутренний контракт.
  const capsule = (
    <div
      key="shell-capsule"
      className="homeCapsule"
      ref={capsuleRef}
      data-open={open !== "none" || undefined}
      role="group"
      aria-label="Панель пользователя"
    >
      {user ? (
        <button
          type="button"
          className="homeCapsuleAvatar pressable"
          data-touch-target="48"
          aria-label="Профиль"
          aria-haspopup="dialog"
          aria-expanded={open === "user"}
          data-active={open === "user" || undefined}
          onClick={() => {
            sound.tick();
            setOpen(open === "user" ? "none" : "user");
          }}
        >
          <LiveHeaderMascot
            config={avatar}
            snapshots={avatarSnapshots}
            active={open === "user"}
            notificationCount={overlay.notifications.unreadCount}
            suspended={false}
            typing={mascotTyping}
          />
          {overlay.notifications.unreadCount > 0 ? (
            <span className="homeCapsuleBadge homeCapsuleBadge--avatar" aria-hidden="true">
              {Math.min(overlay.notifications.unreadCount, 9)}
            </span>
          ) : null}
        </button>
      ) : (
        // Гость: та же компактная стекло-пилюля, что «Написать пост»/«Форк» (modelGlassBtn,
        // market/model.css) — не изобретаем третий вид кнопки под один CTA капсулы.
        <button
          type="button"
          className="modelGlassBtn pressable"
          onClick={() => {
            sound.tick();
            promptGuestLogin();
          }}
        >
          Войти
        </button>
      )}

      {open === "user" && user ? (
        <Popover ariaLabel="Меню профиля">
          <button
            type="button"
            className="homePopUser pressable"
            onClick={() => {
              setOpen("none");
              navigate(profilePath(user.username));
            }}
          >
            <span className="homePopUserAvatar">
              <AvatarBubble config={avatar} snapshots={avatarSnapshots} size={44} facing="right" />
            </span>
            <span className="homePopUserIdentity">
              <strong>{user.display_name || `@${user.username}`}</strong>
              <span>@{user.username}</span>
            </span>
            <span className="homePopUserArrow" aria-hidden="true">→</span>
          </button>

          <div className="homePopQuickGrid" aria-label="Быстрые настройки">
            <button
              type="button"
              className="homePopQuick pressable"
              onClick={() => {
                setOpen("none");
                navigate(avatarEditorPath());
              }}
            >
              <PersonaIcon />
              <span>Персонаж</span>
            </button>
            <button
              type="button"
              className="homePopQuick pressable"
              onClick={() => {
                setOpen("none");
                openProfileEdit();
              }}
            >
              <ProfileIcon />
              <span>Данные</span>
            </button>
          </div>

          <span className="homePopSectionLabel">Моя мастерская</span>
          <button
            type="button"
            className="homePopItem pressable"
            onClick={() => {
              setOpen("none");
              navigate(profilePath(user.username, "projects"));
            }}
          >
            <CubeIcon />
            Проекты
            <span className="homePopItemHint">Работы и модели</span>
          </button>
          <button
            type="button"
            className="homePopItem pressable"
            onClick={() => {
              setOpen("none");
              navigate(profilePath(user.username, "posts"));
            }}
          >
            <PostIcon />
            Посты
            <span className="homePopItemHint">Журнал мастерской</span>
          </button>
          <button
            type="button"
            className="homePopItem pressable"
            onClick={() => {
              setOpen("none");
              navigate(profilePath(user.username, "workshop"));
            }}
          >
            <PrinterIcon size={18} />
            Оборудование
            <span className="homePopItemHint">Принтеры и материалы</span>
          </button>
          <button
            type="button"
            className="homePopItem pressable"
            onClick={() => {
              setOpen("none");
              navigate(generatePath());
            }}
          >
            <GenerateIcon />
            Генерации
            <span className="homePopItemHint">История запросов</span>
          </button>

          <span className="homePopDivider" aria-hidden="true" />
          <span className="homePopSectionLabel">Быстрые настройки</span>
          <div className="homePopSettingRow">
            <span>Тема</span>
            <ThemeToggle />
          </div>
          <details
            className="homePopNotifications"
            onToggle={(event) => {
              if (event.currentTarget.open) overlay.notifications.markAllRead();
            }}
          >
            <summary>
              <BellIcon />
              Уведомления
              <span>{overlay.notifications.unreadCount > 0 ? overlay.notifications.unreadCount : ""}</span>
            </summary>
            <div className="homePopNotificationsBody">
              <NotificationCenterList items={overlay.notifications.items} />
            </div>
          </details>
          <button
            type="button"
            className="homePopItem pressable"
            role="switch"
            aria-checked={!overlay.notifications.muted}
            onClick={() => {
              // Звук текущего тапа слышен перед выключением; следующий уже заглушён.
              sound.toggle();
              overlay.notifications.setMuted(!overlay.notifications.muted);
            }}
          >
            {overlay.notifications.muted ? <MuteIcon /> : <SoundIcon />}
            Звук
            <span className="homePopItemState">{overlay.notifications.muted ? "Выкл" : "Вкл"}</span>
          </button>

          <span className="homePopDivider" aria-hidden="true" />

          <button
            type="button"
            className="homePopItem pressable"
            data-danger
            onClick={() => {
              // Плавный выход: гасим страницу, перезагружаем уже «в темноте»
              document.body.classList.add("pageFadeOut");
              void logout().then(() => setTimeout(() => window.location.reload(), 280));
            }}
          >
            <LogoutIcon />
            Выйти
          </button>
        </Popover>
      ) : null}
    </div>
  );

  // Возврат — часть общего API шапки, но не её трёхколоночной сетки: иначе наличие
  // стрелки сдвигает часы и визуально меняет оболочку при переходе между маршрутами.
  const backButton = onBack && (resolvedMode === "back" || resolvedMode === "mixed") ? (
    <div className="homeTopbarBack">
      <IconButton label={backLabel ?? "Назад"} wide={Boolean(backLabel)} onClick={onBack} onPress={sound.tick}>
        <BackIcon />
        {backLabel ? <span className="homeTopbarBackLabel">{backLabel}</span> : null}
      </IconButton>
    </div>
  ) : null;

  // `back` (header.capsule.md § «Четыре режима оболочки»): иммерсив без пользователя и
  // времени — часы/нав-ряд/капсула в итоге НЕ СМОНТИРОВАНЫ (не display:none-заглушка),
  // остаётся только стрелка назад. На время анимации схлопывания (motion.md §10.1) три
  // кластера ещё держатся смонтированными с `data-collapsed`, чтобы transition отыграл, а
  // затем размонтируются — `backSettled` переключает финальную (лёгкую) разметку.
  if (resolvedMode === "back" && backSettled) {
    return (
      <header className="homeTopbar" data-shell={resolvedMode} data-scrolled={scrolled || undefined}>
        <div className="homeTopbarInner homeTopbarInner--back">{backButton}</div>
      </header>
    );
  }

  if (resolvedMode === "back" || chromeCollapsed) {
    return (
      <header className="homeTopbar" data-shell="back" data-scrolled={scrolled || undefined}>
        <div className="homeTopbarInner" data-has-back={Boolean(onBack) || undefined}>
          {backButton}
          <div className="homeTopbarEdge homeTopbarEdge--left" data-collapsed={chromeCollapsed || undefined}>
            <Clock />
          </div>
          <span className="homeTopbarNavSlot" data-collapsed={chromeCollapsed || undefined}>
            {navTabs}
          </span>
          <div className="homeTopbarEdge homeTopbarEdge--right" data-collapsed={chromeCollapsed || undefined}>
            <div className="homeTopbarTools">
              {showAssistantSearch ? <AssistantHeaderSearch key="shell-search" user={user} onTypingChange={setMascotTyping} contextKey={section} /> : null}
              {capsule}
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="homeTopbar" data-shell={resolvedMode} data-scrolled={scrolled || undefined}>
      <div
        className="homeTopbarInner"
        data-has-back={Boolean(backButton) || undefined}
        data-back-wide={Boolean(backButton && backLabel) || undefined}
      >
        {backButton}
        <div className="homeTopbarEdge homeTopbarEdge--left">{clock}</div>
        {navTabs}
        <div className="homeTopbarEdge homeTopbarEdge--right">
          <div className="homeTopbarTools">
            {showAssistantSearch ? <AssistantHeaderSearch key="shell-search" user={user} onTypingChange={setMascotTyping} contextKey={section} /> : null}
            {capsule}
          </div>
        </div>
      </div>

    </header>
  );
}

function Popover({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  return <div className="homePopover" role="dialog" aria-label={ariaLabel}>{children}</div>;
}

// Живые часы + дата слева на странице (в полноэкранном web — всегда; тикер 15с)
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  return (
    <div className="homeClock" style={{ display: "flex", alignItems: "baseline", gap: 10, userSelect: "none" }}>
      {/* Жирные часы (фидбек оператора 2026-07-18) — приложение целится и в полноэкранный
          web-ТВ (header.capsule.md § «Четыре режима»), где часы держат вес всей левой
          колонки шапки в одиночку: 300 читался как случайный тонкий текст, не как якорь. */}
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, lineHeight: 1 }}>{time}</span>
      <span className="homeClockDate" style={{ color: "var(--text-dim)", fontSize: 13 }}>
        {date}
      </span>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 5 8 12l7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 17h11l-1.4-2.1V10a4.1 4.1 0 0 0-8.2 0v4.9L6.5 17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 19c.6.9 1.3 1.3 2 1.3s1.4-.4 2-1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10v4h3.5L12 17.5v-11L7.5 10H4Z" fill="currentColor" />
      <path
        d="M16 9a4.2 4.2 0 0 1 0 6M18.3 6.5a7.7 7.7 0 0 1 0 11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10v4h3.5L12 17.5v-11L7.5 10H4Z" fill="currentColor" />
      <path d="M16 9.5 21 14.5M21 9.5 16 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Иконки меню аватара (фидбек оператора 2026-07-18: список пунктов был плоским текстом) —
// тот же стиль обводки, что и остальные глифы файла (18px, currentColor, strokeWidth 1.6-1.8).
function GenerateIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2 5 14h6l-1 8 9-13h-7l1-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PostIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h14v11H9l-4 3V5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Голова-«куб» маскота (avatar.md) — тот же силуэт, что у самого персонажа, узнаваемая
// метка «редактировать персонажа», а не абстрактная маска.
function PersonaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="12" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9.5" cy="11" r="1.1" fill="currentColor" />
      <circle cx="14.5" cy="11" r="1.1" fill="currentColor" />
      <path d="M9.5 14c1 1 4 1 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 5V3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 20c1.2-4 4.2-6 7-6s5.8 2 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 4H8a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 12h9m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
