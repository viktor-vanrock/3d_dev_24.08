import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { FeedPostCard } from "./postcard.tsx";
import type { FeedPost } from "./api.ts";

const { interactionSound } = vi.hoisted(() => ({
  interactionSound: { tick: vi.fn(), cta: vi.fn(), toggle: vi.fn(), nav: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), offline: vi.fn() },
}));

vi.mock("@platform/sound", () => ({ useInteractionSound: () => interactionSound }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sessionUser = { id: "u1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

const post: FeedPost = {
  id: "gitverse-post",
  type: "gitverse",
  title: "GitVerse-вложение",
  body: "Полный текст поста",
  community_id: null,
  author_id: "author",
  model_id: null,
  media_s3_key: null,
  gitverse_url: "https://gitverse.ru/maker/repo",
  gitverse: {
    owner: "maker",
    name: "repo",
    avatar_url: null,
    description: "Репозиторий для печати",
    stars: 1200,
    language: "TypeScript",
  },
  votes_up: 0,
  votes_down: 0,
  comments_count: 0,
  created_at: "2026-07-01T00:00:00.000Z",
};

const modelLinkPost: FeedPost = {
  id: "model-post",
  type: "model_link",
  title: "Модель в ленте",
  body: null,
  community_id: null,
  author_id: "author",
  model_id: "model-1",
  model: { id: "model-1", title: "Кронштейн для камеры", thumb_url: null, votes_up: 0, downloads_count: 0 },
  media_s3_key: null,
  votes_up: 0,
  votes_down: 0,
  comments_count: 0,
  created_at: "2026-07-01T00:00:00.000Z",
};

describe("FeedPostCard — инлайн-раскрытие", () => {
  it("не возвращается к legacy photo avatar автора", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard
          user={null}
          post={{
            ...post,
            author: {
              id: "author",
              username: "legacy-maker",
              display_name: null,
              avatar_url: "https://example.com/legacy-photo.png",
            },
          }}
          onOpen={() => {}}
        />
      </OverlayProvider>,
    );

    expect(container.querySelector(".feedPostCardHeader > svg")).toBeTruthy();
    expect(container.querySelector('.feedPostCardHeader > img[src*="legacy-photo"]')).toBeNull();
  });

  it("автор — доминантный (верхняя строка), саб и категория — вторичные (метастрока), официальный бейдж — только галочка", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard
          user={null}
          post={{
            ...post,
            community_id: "c1",
            community: { id: "c1", slug: "creality", name: "Creality", kind: "vendor", is_official: true },
            author: { id: "author", username: "plagx", display_name: null, avatar_url: null },
          }}
          onOpen={() => {}}
        />
      </OverlayProvider>,
    );

    const top = container.querySelector(".feedPostCardIdentityTop");
    const meta = container.querySelector(".feedPostCardIdentityMeta");
    expect(top?.textContent).toContain("@plagx");
    expect(top?.textContent).not.toContain("Creality");
    expect(meta?.textContent).toContain("Creality");
    expect(container.querySelector(".feedOfficialBadge")?.textContent).toBe("✓");
  });

  it("клик по имени саба в карточке открывает страницу сообщества", () => {
    render(
      <OverlayProvider>
        <FeedPostCard
          user={null}
          post={{
            ...post,
            community_id: "c1",
            community: { id: "c1", slug: "creality", name: "Creality", kind: "vendor", is_official: true },
            author: { id: "author", username: "plagx", display_name: null, avatar_url: null },
          }}
          onOpen={() => {}}
        />
      </OverlayProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Creality" }));
    expect(window.location.pathname).toBe("/community/creality");
    window.history.replaceState(null, "", "/feed");
  });

  it("показывает вложенный provenance feed_ingest и кликабельный первоисточник", () => {
    render(
      <OverlayProvider>
        <FeedPostCard
          user={null}
          post={{
            ...post,
            provenance: {
              source_url: "https://newsroom.example.com/releases/new-printer?utm_source=feed",
              source_fingerprint: "sha256:source",
              provider: "grok-news-scout",
              model: "qwen3.6-normalizer",
              prompt_version: "news-v1",
            },
          }}
          onOpen={() => {}}
        />
      </OverlayProvider>,
    );

    expect(screen.getByText("Подготовлено агентом")).toBeTruthy();
    expect(screen.getByText("Grok · qwen3.6-normalizer")).toBeTruthy();
    expect(screen.getByRole("link", { name: /newsroom\.example\.com/i }).getAttribute("href")).toBe(
      "https://newsroom.example.com/releases/new-printer?utm_source=feed",
    );
  });

  it("помещает понятный рейтинг в футер карточки и не открывает пост по голосу", async () => {
    const actor = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={{ ...post, score_approx: true }} onOpen={onOpen} />
      </OverlayProvider>,
    );

    const rating = screen.getByRole("group", { name: "Рейтинг поста" });
    expect(rating.closest(".feedPostCardFooter")).toBeTruthy();
    expect(screen.getByText("Рейтинг")).toBeTruthy();
    expect(screen.getByLabelText("Приблизительный рейтинг: 0 голосов").textContent).toBe("~0");

    await actor.click(screen.getByRole("button", { name: "Голосовать за пост, сейчас 0 голосов" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("открывает карточку с клавиатуры, когда фокус стоит на самой карточке", async () => {
    const actor = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={post} onOpen={onOpen} />
      </OverlayProvider>,
    );

    screen.getByRole("link", { name: /GitVerse-вложение/ }).focus();
    await actor.keyboard("{Enter}");

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("даёт ссылке GitVerse доступное имя", () => {
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={post} onOpen={() => {}} />
      </OverlayProvider>,
    );

    expect(screen.getByRole("link", { name: "Открыть репозиторий maker/repo на GitVerse" })).toBeTruthy();
  });

  it("делает переход к полному посту доступным только после раскрытия", async () => {
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={post} onOpen={() => {}} />
      </OverlayProvider>,
    );

    expect(screen.queryByText("Перейти к посту →")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Раскрыть" }));

    expect(screen.getByRole("button", { name: "Свернуть" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Перейти к посту →" })).toBeTruthy();
  });

  it("даёт tick в начале тапа по pill, без повторного звука на click", () => {
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={post} onOpen={() => {}} />
      </OverlayProvider>,
    );

    const pill = screen.getByRole("button", { name: "Раскрыть" });
    fireEvent.pointerDown(pill);
    expect(interactionSound.tick).toHaveBeenCalledTimes(1);

    fireEvent.click(pill);
    expect(interactionSound.tick).toHaveBeenCalledTimes(1);
  });

  it("даёт превью модели доступное имя и открывает её пробелом с клавиатуры", async () => {
    const actor = userEvent.setup();
    render(
      <OverlayProvider>
        <FeedPostCard user={null} post={modelLinkPost} onOpen={() => {}} />
      </OverlayProvider>,
    );

    const preview = screen.getByRole("button", { name: "Открыть модель: Кронштейн для камеры" });

    preview.focus();
    await actor.keyboard(" ");

    expect(window.location.pathname).toBe("/project/model-1");
  });
});

// MF-2035: media_kind раньше игнорировался в двух местах — (1) свёрнутая карточка всегда
// рисовала play-иконку поверх превью (лживая аффорданса на фото), (2) раскрытый пост всегда
// рендерил <video controls> (чёрный неиграющий кадр для фото). Регрессия на оба места, оба
// ветвления (image/video).
describe("FeedPostCard — media_kind определяет img vs video (MF-2035)", () => {
  const mediaPostBase: FeedPost = {
    id: "media-post",
    type: "media",
    title: "Медиа-пост",
    body: null,
    community_id: null,
    author_id: "author",
    model_id: null,
    media_s3_key: "public/feed/author/photo.webp",
    media_url: "https://cdn.example/photo.webp",
    votes_up: 0,
    votes_down: 0,
    comments_count: 0,
    created_at: "2026-07-01T00:00:00.000Z",
  };

  it("свёрнутая карточка: media_kind=image не рисует play-иконку поверх превью", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard user={null} post={{ ...mediaPostBase, media_kind: "image" }} onOpen={() => {}} />
      </OverlayProvider>,
    );

    expect(container.querySelector(".feedPostCardMediaPlay")).toBeNull();
  });

  it("свёрнутая карточка: media_kind=video продолжает рисовать play-иконку", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard user={null} post={{ ...mediaPostBase, media_kind: "video" }} onOpen={() => {}} />
      </OverlayProvider>,
    );

    expect(container.querySelector(".feedPostCardMediaPlay")).not.toBeNull();
  });

  it("раскрытый пост: media_kind=image рендерит img, не video", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard user={null} post={{ ...mediaPostBase, media_kind: "image" }} onOpen={() => {}} />
      </OverlayProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Раскрыть" }));

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".feedPostImage")).not.toBeNull();
  });

  it("раскрытый пост: media_kind=video продолжает рендерить video controls", () => {
    const { container } = render(
      <OverlayProvider>
        <FeedPostCard user={null} post={{ ...mediaPostBase, media_kind: "video" }} onOpen={() => {}} />
      </OverlayProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Раскрыть" }));

    expect(container.querySelector("video")).not.toBeNull();
  });
});

describe("FeedPostCard — телеметрия голоса (MF-980)", () => {
  it("бьёт в ручку голоса за пост тапом авторизованного пользователя (сервер эмитит feed_vote)", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ votes_up: 1, votes_down: 0, my_vote: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OverlayProvider>
        <FeedPostCard user={sessionUser} post={post} onOpen={() => {}} />
      </OverlayProvider>,
    );

    await actor.click(screen.getByRole("button", { name: "Голосовать за пост, сейчас 0 голосов" }));

    // feed_vote (MF-823) эмитится сервером внутри apps/api/src/feed/vote.ts на этот POST — клиент
    // ничего не шлёт в /feed/events сам, поэтому телеметрия проверяется через факт вызова ручки.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/feed/posts/gitverse-post/vote"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ value: 1 }) }),
    );
  });
});
