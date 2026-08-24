import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { HomeHeader } from "./homeheader.tsx";
// Легатное ребро platform→pages, тот же прецедент, что profileedit.tsx в homeheader.tsx.
// eslint-disable-next-line boundaries/element-types, boundaries/entry-point
import "@pages/home/home.css";

// Четыре режима общей шапки: presentation/full/back/mixed.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function readHeaderStyles() {
  const homeStyles = ["home.shell.css", "home.topbar.css", "home.capsule.css", "home.interactions.css"]
    .map((file) => readFileSync(resolve(process.cwd(), `src/pages/home/${file}`), "utf8"))
    .join("\n");
  const searchStyles = readFileSync(resolve(process.cwd(), "src/domains/ai/assistant/headersearch.css"), "utf8");
  return `${homeStyles}\n${searchStyles}`;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("HomeHeader — четыре режима оболочки", () => {
  it("выносит возврат из трёхколоночной сетки, сохраняя геометрию хедера", () => {
    const onBack = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} onBack={onBack} mode="mixed" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const backButton = screen.getByRole("button", { name: "Назад" });
    expect(backButton.closest(".homeTopbarBack")).toBeTruthy();
    expect(container.querySelector(".homeTopbarEdge--left .homeTopbarBack")).toBeNull();

    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("табы компактны и имеют отдельные hover/focus-visible состояния", () => {
    const styles = readHeaderStyles();

    expect(styles).toMatch(/\.homeSectionTabs\.uiSegmentToggle \{[\s\S]*?padding: 3px;/);
    expect(styles).toMatch(/\.homeSectionTabs \.uiSegmentToggleOption \{[\s\S]*?min-height: 38px;/);
    expect(styles).toMatch(/\.homeSectionTabs \.uiSegmentToggleOption:not\(\[data-selected\]\):hover/);
    expect(styles).toMatch(/\.homeSectionTabs \.uiSegmentToggleOption:focus-visible/);
    expect(styles).toMatch(/\[data-input-mode="dpad"\] \.homeTopbar \.homeSectionTabs \.uiSegmentToggleOption \{\s*min-height: var\(--tv-target-min\);/);
    expect(styles).not.toMatch(/\n {2}\.homeTopbar \.homeSectionTabs \.uiSegmentToggleOption \{\s*min-height: var\(--tv-target-min\);/);
  });

  it("капсула нормализует иконки и оставляет персонажу прозрачный силуэт без круга", () => {
    const styles = readHeaderStyles();

    expect(styles).toMatch(/\.homeCapsuleControl > svg \{[\s\S]*?width: 20px;[\s\S]*?height: 20px;/);
    expect(styles).toMatch(/\.homeCapsule \.wispToggle \{[\s\S]*?--wisp-w: 46px;[\s\S]*?--wisp-knob: 22px;/);
    expect(styles).toMatch(/\.homeCapsuleAvatar \{[\s\S]*?border: 1px solid/);
    expect(styles).toMatch(/\.homeCapsuleAvatar \{[\s\S]*?background: transparent/);
    expect(styles).toMatch(/\.liveHeaderMascotCanvas \{[\s\S]*?opacity: 0/);
  });

  it("удерживает компактную avatar-only капсулу без движения всего chrome между страницами", () => {
    const styles = readHeaderStyles();

    expect(styles).toMatch(
      /@media \(min-width: 641px\) \{[\s\S]*?\.homeCapsule \{[\s\S]*?width: 46px;[\s\S]*?height: 46px;/,
    );
    expect(styles).toMatch(/::view-transition-new\(site-header\) \{[\s\S]*?animation: none;[\s\S]*?opacity: 1;/);
    expect(styles).toMatch(/::view-transition-new\(root\) \{[\s\S]*?shellPageIn 260ms/);
    expect(styles).not.toMatch(/:root\[data-nav-fallback\] \.homeTopbar \{/);
    expect(styles).not.toMatch(/@keyframes fallbackHeaderIn/);
    expect(styles).not.toMatch(/@keyframes siteHeaderIn/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?::view-transition-new\(root\)[\s\S]*?animation-duration: 1ms;/,
    );
  });

  it("не раздувает капсулу мок-сводкой о печати", async () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader
            user={user}
            printers={[{ id: "p1", brand: "Creality", model: "K1", is_primary: true, verified: true }]}
            section="printers"
            onSectionChange={() => {}}
          />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(container.querySelector(".homeCapsule")).toBeTruthy());
    expect(container.querySelector('[data-testid="print-summary-pill"]')).toBeNull();
    expect(container.querySelector(".homeCapsule")?.hasAttribute("data-context")).toBe(false);
  });

  it("на mobile фиксирует капсулу в правой колонке, когда табы скрыты", () => {
    const styles = readHeaderStyles();
    const mobileLayoutStart = styles.indexOf("/* Bottom-tab");
    const mobileLayoutEnd = styles.indexOf("/* Переход Дом", mobileLayoutStart);
    const mobileLayout = styles.slice(mobileLayoutStart, mobileLayoutEnd);

    expect(mobileLayout).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.homeTopbarInner > \.homeTopbarEdge--right \{\s*grid-column: 3;/,
    );
  });

  it("на mobile резервирует левый гаттер под стрелку возврата, не трогая страницы без onBack (MF-1880)", () => {
    const styles = readHeaderStyles();
    const mobileLayoutStart = styles.indexOf("/* Bottom-tab");
    const mobileLayoutEnd = styles.indexOf("/* Переход Дом", mobileLayoutStart);
    const mobileLayout = styles.slice(mobileLayoutStart, mobileLayoutEnd);

    expect(mobileLayout).toMatch(/\.homeTopbarInner\[data-has-back\] \{\s*padding-inline-start: 62px;/);

    const withBack = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} onBack={() => {}} mode="mixed" />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(withBack.container.querySelector(".homeTopbarInner[data-has-back]")).toBeTruthy();
    withBack.unmount();

    const withoutBack = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(withoutBack.container.querySelector(".homeTopbarInner[data-has-back]")).toBeNull();
  });

  it("на узком mobile тиры капсулы могут схлопнуться без переполнения контролов", () => {
    const styles = readHeaderStyles();
    const tierStart = styles.indexOf(".homeCapsuleTier {");
    const tierEnd = styles.indexOf(".homeCapsuleControl.homeCapsuleGrip", tierStart);
    const tierStyles = styles.slice(tierStart, tierEnd);

    expect(tierStyles).toMatch(/\.homeCapsuleTier \{[\s\S]*?min-width: 0;/);
  });

  it("на mobile раскрытые тиры капсулы выходят в отдельную панель без сжатия hit-area", () => {
    const styles = readHeaderStyles();
    const mobileStart = styles.lastIndexOf("@media (max-width: 640px)");
    const mobileStyles = styles.slice(mobileStart);

    expect(styles).toMatch(/\.homeCapsuleOverflow \{\s*display: contents;/);
    expect(mobileStyles).toMatch(
      /\.homeCapsule\[data-expanded\] \.homeCapsuleOverflow \{[\s\S]*?position: absolute;[\s\S]*?display: flex;/,
    );
    expect(mobileStyles).toMatch(
      /\.homeCapsule\[data-expanded\] \.homeCapsuleTier \{[\s\S]*?max-width: none;[\s\S]*?overflow: visible;/,
    );
    expect(mobileStyles).toMatch(/body:has\(\.homeCapsule\[data-expanded\]\) \{[\s\S]*?--header-safe: 136px;/);
    expect(styles).not.toMatch(/grid-template-rows: 52px 60px;/);
  });

  it("на маршруте профиля один раз пишет profile_view", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        activationEvents.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }),
    );
    window.history.replaceState(null, "", `/u/${user.username}`);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(activationEvents).toContainEqual({ event_name: "profile_view", props: {} }));
  });

  it("клавиатурный выбор раздела пишет nav_item_click", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        activationEvents.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }),
    );
    const onSectionChange = vi.fn();

    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={onSectionChange} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Проекты" }));

    expect(onSectionChange).toHaveBeenCalledWith("market");
    await waitFor(() => expect(activationEvents).toContainEqual({ event_name: "nav_item_click", props: { item: "project" } }));
  });

  it("аватар остаётся единственной кнопкой капсулы, а тема живёт внутри его меню", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const profile = screen.getByLabelText("Профиль");
    expect(profile.getAttribute("data-touch-target")).toBe("48");

    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(profile);
    const theme = screen.getByRole("switch", { name: /тёмн/i });
    expect(theme.getAttribute("data-touch-target")).toBe("48");
    expect(screen.getByText("Уведомления")).toBeTruthy();
  });

  it("presentation — компактная шапка главного экрана", () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} mode="presentation" />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('.homeTopbar[data-shell="presentation"]')).toBeTruthy();
    expect(container.querySelector('.homeTopbar[data-shell="full"]')).toBeNull();
    expect(container.querySelector(".assistantHeaderSearch")).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.getByText("Проекты")).toBeTruthy();
  });

  it("full — data-shell='full' + нав-табы из общего реестра navitems.ts (MF-851/MF-2051)", () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} mode="full" />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('.homeTopbar[data-shell="full"]')).toBeTruthy();
    expect(screen.getByText("Дом")).toBeTruthy();
    expect(screen.getByText("Новости")).toBeTruthy();
    expect(screen.getByText("Принтеры")).toBeTruthy();
    expect(screen.getByText("Проекты")).toBeTruthy();
    expect(screen.getByText("Материалы")).toBeTruthy();
    expect(screen.queryByText("Идеи")).toBeNull();
    expect(container.querySelector(".homeSectionTabs")).toBeTruthy();
    expect(container.querySelector(".assistantHeaderSearch")).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("поиск анимируется только при mount и не получает повторный scale на каждом route", () => {
    const styles = readHeaderStyles();

    expect(styles).toMatch(/\.assistantHeaderSearch \{[\s\S]*?animation: assistantHeaderSearchIn var\(--dur-nav\)/);
    expect(styles).not.toMatch(/view-transition-name: shell-assistant-search/);
    expect(styles).not.toMatch(/::view-transition-new\(shell-assistant-search\)/);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.assistantHeaderSearch,[\s\S]*?animation: none;/,
    );
  });

  it("mixed — возврат и полный хром смонтированы вместе", () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader
            user={user}
            printers={[]}
            section="market"
            onSectionChange={() => {}}
            onBack={() => {}}
            backLabel="К проекту"
            mode="mixed"
          />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('.homeTopbar[data-shell="mixed"]')).toBeTruthy();
    expect(container.querySelector(".homeClock")).toBeTruthy();
    expect(container.querySelector(".homeSectionTabs")).toBeTruthy();
    expect(container.querySelector(".homeCapsule")).toBeTruthy();
    expect(container.querySelector(".homeTopbarInner[data-back-wide]")).toBeTruthy();
    expect(screen.getByLabelText("К проекту")).toBeTruthy();
  });

  it("уплотнение стекла по скроллу (header-capsule.md § «Уплотнение стекла») — [data-scrolled] следует за window.scrollY", async () => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector(".homeTopbar[data-scrolled]")).toBeNull();

    Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
    fireEvent.scroll(window);
    await waitFor(() => expect(container.querySelector(".homeTopbar[data-scrolled]")).toBeTruthy());
  });

  it("быстрая настройка «Данные» открывает модалку правки профиля", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Профиль"));
    fireEvent.click(screen.getByRole("button", { name: "Данные" }));
    expect(screen.getByLabelText("@ник")).toBeTruthy();
  });

  it("быстрая настройка «Персонаж» ведёт в отдельную мастерскую", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Профиль"));
    fireEvent.click(screen.getByRole("button", { name: "Персонаж" }));
    expect(window.location.pathname).toBe("/profile/avatar");
  });

  it("меню профиля группирует адресуемые разделы мастерской", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Профиль"));
    const items = screen.getAllByRole("button", { name: /Проекты|Посты|Оборудование|Генерации|Выйти/ });
    expect(items.map((item) => item.textContent)).toEqual([
      "ПроектыРаботы и модели",
      "ПостыЖурнал мастерской",
      "ОборудованиеПринтеры и материалы",
      "ГенерацииИстория запросов",
      "Выйти",
    ]);
  });

  it("капсула ведёт оборудование прямо в приватную мастерскую профиля", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="home" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByLabelText("Профиль"));
    fireEvent.click(screen.getByRole("button", { name: /^Оборудование/ }));
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/u/${user.username}?tab=workshop`);
  });

  it("самостоятельный пользовательский слой не подсвечивает глобальный раздел", () => {
    render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader
            user={user}
            printers={[]}
            section="market"
            activeSection={null}
            onSectionChange={() => {}}
          />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(screen.getAllByRole("tab").every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
  });
});

describe("HomeHeader — режим back", () => {
  it("data-shell='back': часы/нав/капсула не смонтированы, остаётся только возврат", async () => {
    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <HomeHeader user={user} printers={[]} section="market" onSectionChange={() => {}} onBack={() => {}} mode="back" />
        </OverlayProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelector('.homeTopbar[data-shell="back"]')).toBeTruthy());
    await waitFor(() => expect(container.querySelector(".homeClock")).toBeNull());
    expect(container.querySelector(".homeSectionTabs")).toBeNull();
    expect(container.querySelector(".homeCapsule")).toBeNull();
    expect(screen.getByLabelText("Назад")).toBeTruthy();
  });
});
