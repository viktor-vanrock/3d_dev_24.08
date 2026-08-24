import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CommunityScreen } from "./communityscreen.tsx";

vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header /> }));
vi.mock("@shared/ui/aurorabg.tsx", () => ({ AuroraBackground: () => null }));
vi.mock("@platform/overlay", () => ({
  useOverlay: () => ({ modal: vi.fn(), toast: vi.fn() }),
}));
vi.mock("@platform/sound", () => ({
  useInteractionSound: () => ({ tick: vi.fn(), toggle: vi.fn(), cta: vi.fn() }),
}));
vi.mock("@domains/access/guestlogin.tsx", () => ({ useGuestLogin: () => vi.fn() }));

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunityScreen (MF-1756)", () => {
  it("разделяет тип и статус треда, объясняет голоса и использует нативную кнопку карточки", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/qa-generated")) {
          return response({
            id: "community-1",
            slug: "qa-generated",
            name: "QA Q&A",
            kind: "custom",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: "user-1",
            created_at: "2026-07-16T10:00:00Z",
            member_count: 1,
            thread_count: 1,
            viewer_role: "owner",
          });
        }
        if (path.endsWith("/communities/community-1/threads")) {
          return response({
            items: [
              {
                id: "thread-1",
                community_id: "community-1",
                author_id: "user-1",
                type: "question",
                title: "Как выбрать сопло?",
                content: "Нужен совет для PLA.",
                status: "open",
                pinned: false,
                accepted_post_id: "post-1",
                votes_up: 2,
                votes_down: 1,
                post_count: 1,
                tags: ["pla"],
                created_at: "2026-07-16T10:00:00Z",
                updated_at: "2026-07-16T11:00:00Z",
              },
            ],
            next_cursor: null,
          });
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="qa-generated" />);

    const threadAction = await screen.findByRole("button", { name: /Как выбрать сопло/ });
    expect(threadAction.tagName).toBe("BUTTON");
    expect(screen.getByLabelText("Тип треда: Вопрос")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Статус треда: решён" })).toBeTruthy();
    expect(screen.getByText("Голоса")).toBeTruthy();
  });

  // 2026-07-21: официальный (vendor/machine) саб показывал ТОЛЬКО треды — реальный контент
  // (co-authored посты контент-агентов) был не виден на его собственной странице. Живая проверка
  // оператором: "Открыть сообщество" на посте вёл сюда и упирался в "Тредов пока нет".
  it("официальный саб по умолчанию показывает вкладку «Новости» с постами, не треды", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/creality")) {
          return response({
            id: "community-2",
            slug: "creality",
            name: "Creality",
            kind: "vendor",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: null,
            created_at: "2026-07-21T10:00:00Z",
            member_count: 1,
            thread_count: 0,
            viewer_role: "member",
            website: null,
            related_communities: [],
          });
        }
        if (path.includes("/communities/community-2/feed")) {
          return response({
            items: [
              {
                id: "post-1",
                type: "text",
                title: "Creality представляет SPARKX i7",
                body: "текст",
                community_id: "community-2",
                author_id: "user-1",
                model_id: null,
                media_s3_key: null,
                votes_up: 0,
                votes_down: 0,
                comments_count: 0,
                created_at: "2026-07-21T10:00:00Z",
              },
            ],
            next_cursor: null,
          });
        }
        if (path.endsWith("/communities/community-2/threads")) return response({ items: [], next_cursor: null });
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="creality" />);

    expect(await screen.findByText("Creality представляет SPARKX i7")).toBeTruthy();
    expect(screen.queryByText("Тредов пока нет. Начните обсуждение")).toBeNull();
  });

  // 2026-07-21: "полноценная страница бренда" — логотип (favicon по vendors.website, буква как
  // фоллбэк) и чипы "Все сабы" (related_communities) в шапке.
  it("показывает favicon-логотип бренда, если у сообщества есть website", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/creality")) {
          return response({
            id: "community-3",
            slug: "creality",
            name: "Creality",
            kind: "vendor",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: null,
            created_at: "2026-07-21T10:00:00Z",
            member_count: 1,
            thread_count: 0,
            viewer_role: "member",
            website: "creality.com",
            related_communities: [],
          });
        }
        if (path.includes("/communities/community-3/feed")) return response({ items: [], next_cursor: null });
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="creality" />);

    await screen.findByText("Creality");
    const logo = document.querySelector(".cmtyLogo img") as HTMLImageElement | null;
    expect(logo).toBeTruthy();
    expect(logo!.src).toContain("domain=creality.com");
  });

  it("без website показывает первую букву названия вместо логотипа", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/qidi")) {
          return response({
            id: "community-4",
            slug: "qidi",
            name: "QIDI",
            kind: "vendor",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: null,
            created_at: "2026-07-21T10:00:00Z",
            member_count: 1,
            thread_count: 0,
            viewer_role: "member",
            website: null,
            related_communities: [],
          });
        }
        if (path.includes("/communities/community-4/feed")) return response({ items: [], next_cursor: null });
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="qidi" />);

    await screen.findByText("QIDI");
    expect(document.querySelector(".cmtyLogo img")).toBeNull();
    expect(document.querySelector(".cmtyLogo")?.textContent).toBe("Q");
  });

  it("рендерит чипы «Все сабы» и переходит по клику в связанный саб", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/creality")) {
          return response({
            id: "community-5",
            slug: "creality",
            name: "Creality",
            kind: "vendor",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: null,
            created_at: "2026-07-21T10:00:00Z",
            member_count: 1,
            thread_count: 0,
            viewer_role: "member",
            website: null,
            related_communities: [{ id: "community-6", slug: "creality-k1", name: "Creality K1", kind: "machine" }],
          });
        }
        if (path.includes("/communities/community-5/feed")) return response({ items: [], next_cursor: null });
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="creality" />);

    const chip = await screen.findByRole("button", { name: /Creality K1/ });
    chip.click();
    expect(window.location.pathname).toBe("/community/creality-k1");
  });

  it("не рендерит ряд «Все сабы», если related_communities пуст", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith("/communities/creality")) {
          return response({
            id: "community-7",
            slug: "creality",
            name: "Creality",
            kind: "vendor",
            description: null,
            cover_image_url: null,
            visibility: "public",
            status: "active",
            created_by: null,
            created_at: "2026-07-21T10:00:00Z",
            member_count: 1,
            thread_count: 0,
            viewer_role: "member",
            website: null,
            related_communities: [],
          });
        }
        if (path.includes("/communities/community-7/feed")) return response({ items: [], next_cursor: null });
        return new Response(null, { status: 404 });
      }),
    );

    render(<CommunityScreen user={user} section="home" onSectionChange={() => {}} slug="creality" />);

    await screen.findByText("Creality");
    expect(screen.queryByLabelText("Связанные сабы бренда")).toBeNull();
  });
});
