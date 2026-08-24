import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { FeedScreen } from "./feedscreen.tsx";
import type { FeedPost } from "./api.ts";

// Пагинация/skeleton ленты /feed (MF-974, docs/design/feed.md §4). Проверяет: первая загрузка —
// skeleton-карточки, затем реальные посты; сентинел-инфинит-скролл переключается на кнопку
// «Показать ещё» после 3 автодогрузок подряд (AUTO_LOAD_LIMIT); конец ленты — «Вы всё прочитали».

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function post(id: string): FeedPost {
  return {
    id,
    type: "text",
    title: `Пост ${id}`,
    body: "текст",
    community_id: null,
    author_id: "a",
    model_id: null,
    media_s3_key: null,
    votes_up: 0,
    votes_down: 0,
    comments_count: 0,
    created_at: new Date().toISOString(),
  };
}

function page(ids: string[], nextCursor: string | null) {
  return new Response(JSON.stringify({ items: ids.map(post), next_cursor: nextCursor }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// jsdom не реализует IntersectionObserver — стаб, который сразу считает сентинел видимым, чтобы
// каждый рендер сентинела детерминированно триггерил loadMore (тот же приём эффекта в
// feedscreen.tsx: сентинел просто отслеживается наблюдателем).
class FakeIntersectionObserver {
  #callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    this.#callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/feed");
});

describe("FeedScreen пагинация (MF-974)", () => {
  it("показывает фильтр ленты едиными табами над изменяемым контентом", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => page([], null)));
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const tabs = screen.getByRole("tablist", { name: "Фильтр ленты" });
    const allTab = screen.getByRole("tab", { name: "Лента" });
    const subscriptionsTab = screen.getByRole("tab", { name: "Подписки" });
    expect(screen.getByRole("main").contains(tabs)).toBe(true);
    expect(tabs.closest(".feedCreateCard")).toBeNull();
    expect(tabs.parentElement?.classList.contains("feedSideLeft")).toBe(true);
    expect(tabs.nextElementSibling?.classList.contains("feedCreateCard")).toBe(true);
    expect(screen.queryByRole("heading", { name: /Лента мастерской|Все посты/ })).toBeNull();
    expect(allTab.getAttribute("aria-selected")).toBe("true");

    await interaction.click(subscriptionsTab);
    expect(`${window.location.pathname}${window.location.search}`).toBe("/feed?scope=subscribed");
  });

  it("показывает реальные подписки слева и отмечает каталожный саб как официальный", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/communities?member=me")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "c-official",
                  slug: "bambu-lab",
                  name: "Bambu Lab",
                  kind: "vendor",
                  is_official: true,
                },
              ],
              next_cursor: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/communities")) return communityPage([]);
        return page([], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const subscriptions = await screen.findByRole("navigation", { name: "Мои сабы" });
    expect(within(subscriptions).getByText("Bambu Lab")).toBeTruthy();
    expect(within(subscriptions).getByText("Официальный канал")).toBeTruthy();
  });

  // MF-2039: "Мои сабы" рисовал цветную букву даже для официальных сабов с известным доменом —
  // теперь показывает реальный favicon бренда, с fallback на букву если картинка не загрузится.
  it("рисует favicon бренда в «Мои сабы», когда у саба есть website, и откатывается на букву без него", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/communities?member=me")) {
          return new Response(
            JSON.stringify({
              items: [
                { id: "c-with-site", slug: "bambu-lab", name: "Bambu Lab", kind: "vendor", is_official: true, website: "bambulab.com" },
                { id: "c-no-site", slug: "my-club", name: "Мой клуб", kind: "custom", is_official: false, website: null },
              ],
              next_cursor: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/communities")) return communityPage([]);
        return page([], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const subscriptions = await screen.findByRole("navigation", { name: "Мои сабы" });
    const withSiteRow = within(subscriptions).getByText("Bambu Lab").closest(".feedSubRow") as HTMLElement;
    const favicon = withSiteRow.querySelector("img");
    expect(favicon?.getAttribute("src")).toBe("https://www.google.com/s2/favicons?sz=64&domain=bambulab.com");

    const noSiteRow = within(subscriptions).getByText("Мой клуб").closest(".feedSubRow") as HTMLElement;
    expect(noSiteRow.querySelector("img")).toBeNull();
    expect(noSiteRow.querySelector(".feedSubMark")?.textContent).toBe("М");
  });

  // 2026-07-21: клик по любому сабу — официальному или custom — ведёт на его страницу
  // (/community/:slug). Официальный саб теперь сам показывает посты на этой странице (вкладка
  // "Новости", communityscreen.tsx) — редиректить мимо неё в отфильтрованную ленту не нужно
  // (была такая попытка — оператор явно поправил: нужна именно страница сообщества, не тег).
  it("клик по любому сабу — официальному или custom — открывает его страницу /community/:slug", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/communities?member=me")) {
          return new Response(
            JSON.stringify({
              items: [
                { id: "c-official", slug: "bambu-lab", name: "Bambu Lab", kind: "vendor", is_official: true },
                { id: "c-custom", slug: "my-club", name: "Мой клуб", kind: "custom", is_official: false },
              ],
              next_cursor: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/communities")) return communityPage([]);
        return page([], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const subscriptions = await screen.findByRole("navigation", { name: "Мои сабы" });
    await interaction.click(within(subscriptions).getByText("Bambu Lab"));
    expect(window.location.pathname).toBe("/community/bambu-lab");

    await interaction.click(within(subscriptions).getByText("Мой клуб"));
    expect(window.location.pathname).toBe("/community/my-club");
  });

  it("показывает skeleton на первой загрузке, затем посты", async () => {
    let resolveFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        await gate;
        const url = String(input);
        // Правая колонка (MF-971) грузит «сейчас горячо»/каталог фидов тем же тиком — нужен
        // отдельный (пустой) ответ, иначе «Пост 1»/«Пост 2» задваиваются в мини-карточках, а
        // каталог падает на community-shape без name (communityDisplayName).
        if (url.includes("sort=hot")) return page([], null);
        if (url.includes("/communities")) return communityPage([]);
        return page(["1", "2"], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(container.querySelectorAll(".feedPostCardSkeleton").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".feedRailSkeleton").length).toBe(2);

    resolveFirst();
    await waitFor(() => expect(screen.getByText("Пост 1")).toBeTruthy());
    expect(container.querySelectorAll(".feedPostCardSkeleton").length).toBe(0);
    expect(container.querySelectorAll(".feedRailSkeleton").length).toBe(0);
    expect(screen.getByText("Осталось непрочитанных: 2")).toBeTruthy();
    expect(screen.queryByText("Вы всё прочитали")).toBeNull();
  });

  it("показывает «Вы всё прочитали», только когда все карточки отмечены прочитанными", async () => {
    sessionStorage.setItem("portal.feed.readPosts", JSON.stringify(["1", "2"]));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // Правая колонка (MF-971) грузит «сейчас горячо»/каталог фидов тем же тиком — см.
        // комментарий в предыдущем тесте.
        if (url.includes("sort=hot")) return page([], null);
        if (url.includes("/communities")) return communityPage([]);
        return page(["1", "2"], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("Вы всё прочитали")).toBeTruthy();
    expect(screen.queryByText(/Непрочитанных постов:/)).toBeNull();
  });

  it("после 3 автодогрузок подряд переключается на кнопку «Показать ещё»", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        // Баннер первого входа (feed.md §4) и правая колонка (MF-971, каталог фидов/«сейчас
        // горячо») дёргают /communities и /feed?sort=hot отдельно от пагинации ленты — не
        // считаем эти вызовы в последовательности call===1..4, иначе тест ловит чужой индекс.
        if (String(input).includes("/communities")) return page([], null);
        if (String(input).includes("sort=hot")) return page([], null);
        call += 1;
        if (call === 1) return page(["1"], "c1");
        if (call <= 4) return page([`a${call}`], `c${call}`);
        return page([`last`], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await screen.findByRole("button", { name: "Показать ещё" }, { timeout: 5_000 });
    // Ровно 3 автодогрузки успели пройти (звенья 2/3/4) до того, как сентинел перестал
    // триггерить — 4-й вызов listFeed (call===4) уже пришёл кнопкой, не автотриггером.
    expect(call).toBe(4);
  });
});

describe("FeedScreen скоуп конкретного саба (MF-970)", () => {
  it("показывает имя саба, загружает его ленту и позволяет отписаться", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/communities/bambu-lab-fanaty")) {
        return new Response(
          JSON.stringify({
            id: "community-1",
            slug: "bambu-lab-fanaty",
            name: "Bambu Lab фанаты",
            viewer_role: "member",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/communities/community-1/feed?")) return page(["1"], null);
      if (url.endsWith("/communities/community-1/subscribe") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      // Правая колонка (MF-971) грузит «сейчас горячо»/каталог фидов независимо от скоупа/саба.
      if (url.includes("/feed?sort=hot")) return page([], null);
      if (url.includes("/communities?")) return communityPage([]);
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} community="bambu-lab-fanaty" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("# Bambu Lab фанаты")).toBeTruthy();
    expect(await screen.findByText("Пост 1")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/communities/community-1/feed?limit=24"), {
      credentials: "include",
    });

    await actor.click(screen.getByRole("button", { name: "Отписаться" }));

    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/feed"));
    // Отписка обязана бить в /subscribe (не историческую /leave) — только она пишет
    // community_subscribe (MF-823/MF-980, apps/api/src/community/membership.ts), иначе воронка
    // MF-808 теряет отписки из ленты молча.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/communities/community-1/subscribe"), {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "feed_left" }),
    });
  });
});

describe("FeedScreen телеметрия (MF-980)", () => {
  it("шлёт feed_scope_change при явном переключении сегмента «Всё»/«Мои подписки»", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/feed/events")) return new Response(JSON.stringify({ ok: true }), { status: 202 });
      return page([], null);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const subscriptionsTab = await screen.findByRole("tab", { name: "Подписки" });
    await actor.click(subscriptionsTab);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/feed/events"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ event_name: "feed_scope_change", props: { scope: "subscribed" } }),
        }),
      ),
    );
  });
});

function communityPage(items: { id: string; name: string }[]) {
  return new Response(JSON.stringify({ items, next_cursor: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("FeedScreen первый вход без подписок (MF-975, feed.md §4)", () => {
  it("показывает баннер с предложенными сабами, не блокирует чтение ленты, подписывает по тапу", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/communities?member=me")) return communityPage([]);
      if (url.includes("/communities?limit=3")) {
        return communityPage([
          { id: "c1", name: "Bambu Lab фанаты" },
          { id: "c2", name: "Prusa клуб" },
          { id: "c3", name: "Voron сборка" },
        ]);
      }
      // Баннер зовёт актуальный /subscribe (MF-767/MF-421/MF-980), не историческую /join.
      if (url.endsWith("/communities/c1/subscribe") && init?.method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ source: "feed_right" }));
        return new Response(JSON.stringify({ role: "member" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // Горячие сообщества правой колонки — тот же батч сообществ, другой запрос от баннера.
      if (url.includes("/communities?")) return communityPage([]);
      // «Сейчас горячо» (MF-971) — не путать с основной пагинацией ленты ниже.
      if (url.includes("/feed?sort=hot")) return page([], null);
      if (url.includes("/feed?")) return page(["1", "2"], null);
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("Подпишитесь на свой принтер — лента станет вашей")).toBeTruthy();
    const chip = await screen.findByRole("button", { name: "Bambu Lab фанаты · Подписаться" });
    // Полоса не блокирует чтение ленты под собой (feed.md §4).
    expect(await screen.findByText("Пост 1")).toBeTruthy();

    await actor.click(chip);
    await waitFor(() => expect(screen.getByRole("button", { name: "Bambu Lab фанаты · Подписан" })).toBeTruthy());
  });
});

describe("FeedScreen пустые «Мои подписки» (MF-975, feed.md §4)", () => {
  it("показывает объяснение и первые посты общей ленты с меткой «Из общей ленты»", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("scope=subscribed")) return page([], null);
      if (url.includes("scope=all")) return page(["a", "b", "c", "d", "e"], null);
      // Правая колонка (MF-971) грузит «сейчас горячо»/каталог фидов независимо от скоупа.
      if (url.includes("/feed?sort=hot")) return page([], null);
      if (url.includes("/communities?")) return communityPage([]);
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} scope="subscribed" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("В ваших сабах пока тихо")).toBeTruthy();
    expect(await screen.findByText("Пост a")).toBeTruthy();
    expect(screen.getAllByText("Из общей ленты")).toHaveLength(5);
  });
});

describe("FeedScreen закрытый саб (MF-975, feed.md §4)", () => {
  it("показывает access-gate вместо ленты и открывает её после «Запросить доступ»", async () => {
    const actor = userEvent.setup();
    let joined = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/communities/closed-club")) {
        return new Response(
          JSON.stringify({
            id: "community-closed",
            slug: "closed-club",
            name: "Закрытый клуб",
            visibility: "unlisted",
            viewer_role: joined ? "member" : null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // «Запросить доступ» зовёт актуальный /subscribe (MF-767/MF-421/MF-980), не /join.
      if (url.endsWith("/communities/community-closed/subscribe") && init?.method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ source: "feed_left" }));
        joined = true;
        return new Response(JSON.stringify({ role: "member" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/communities/community-closed/feed?")) return page(["1"], null);
      // Правая колонка (MF-971) грузит «сейчас горячо»/каталог фидов независимо от скоупа/саба.
      if (url.includes("/feed?sort=hot")) return page([], null);
      if (url.includes("/communities?")) return communityPage([]);
      throw new Error(`Неожиданный запрос: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} community="closed-club" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("Это закрытое сообщество")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отписаться" })).toBeNull();

    await actor.click(screen.getByRole("button", { name: "Запросить доступ" }));

    await waitFor(() => expect(screen.getByText("Пост 1")).toBeTruthy());
    expect(screen.queryByText("Это закрытое сообщество")).toBeNull();
  });
});

function hotPost(id: string, title: string, community: { id: string; slug: string; name: string }, votesUp: number, votesDown: number): FeedPost {
  return {
    id,
    type: "text",
    title,
    body: null,
    community_id: community.id,
    community,
    author_id: "a",
    model_id: null,
    media_s3_key: null,
    votes_up: votesUp,
    votes_down: votesDown,
    comments_count: 0,
    created_at: new Date().toISOString(),
  };
}

describe("FeedScreen правая колонка: «Сейчас горячо» (MF-971, feed.md §1.3 п.1)", () => {
  it("показывает мини-карточки с сабом и компакт-голосами, честную метку обновления, открывает пост по тапу", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/feed?sort=hot")) {
        return new Response(
          JSON.stringify({
            items: [hotPost("hot1", "Заголовок горячего поста", { id: "c1", slug: "bambu", name: "Bambu Lab фанаты" }, 42, 2)],
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return page([], null);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    const { container } = render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("Заголовок горячего поста")).toBeTruthy();
    expect(screen.getByText("Bambu Lab фанаты · 40 голосов · 0 ответов")).toBeTruthy();
    expect(screen.getByText("обновлено только что")).toBeTruthy();
    expect(container.querySelector(".feedHotAvatar svg")).toBeTruthy();

    await actor.click(screen.getByText("Заголовок горячего поста"));
    expect(window.location.pathname).toBe("/feed/p/hot1");
  });

  it("честно показывает ошибку загрузки, не выдуманные данные", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/feed?sort=hot")) return new Response(null, { status: 500 });
        return page([], null);
      }),
    );
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText("Не удалось загрузить.")).toBeTruthy();
  });
});

describe("FeedScreen правая колонка: «Горячие сообщества»", () => {
  it("сортирует по числу подписчиков и подписывается оптимистично без ухода со страницы", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/communities?limit=24")) {
        return new Response(
          JSON.stringify({
            items: [
              { id: "c2", slug: "prusa", name: "Prusa клуб", member_count: 50, thread_count: 7, viewer_role: null },
              { id: "c1", slug: "bambu", name: "Bambu Lab фанаты", member_count: 100, thread_count: 12, viewer_role: null },
            ],
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/communities/c1/subscribe") && init?.method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ source: "feed_right" }));
        return new Response(JSON.stringify({ role: "member" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return page([], null);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={user} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const names = await screen.findAllByText(/Bambu Lab фанаты|Prusa клуб/);
    // Больше подписчиков (100 против 50) — выше в списке, хотя бэк отдал в обратном порядке.
    expect(names.map((node) => node.textContent)).toEqual(["Bambu Lab фанаты", "Prusa клуб"]);

    const bambuRow = screen.getByText("Bambu Lab фанаты").closest("li") as HTMLElement;
    await actor.click(within(bambuRow).getByRole("button", { name: "Вступить" }));
    await waitFor(() => expect(within(bambuRow).getByRole("button", { name: "Вы здесь" })).toBeTruthy());
    expect(window.location.pathname).toBe("/feed");
    expect(screen.getByText("Все сообщества →")).toBeTruthy();
    expect(screen.queryByText("Календарь принтеров")).toBeNull();
  });

  it("гостю честно предлагает войти вместо запроса каталога", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => page([], null)));
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    render(
      <ThemeProvider>
        <OverlayProvider>
          <FeedScreen user={null} section="feed" onSectionChange={() => {}} />
        </OverlayProvider>
      </ThemeProvider>,
    );

    const loginLinks = await screen.findAllByRole("button", { name: "Войдите" });
    expect(loginLinks.length).toBeGreaterThan(0);
    await actor.click(loginLinks[0]!);
    expect(await screen.findByText("Войдите, чтобы продолжить")).toBeTruthy();
  });
});
