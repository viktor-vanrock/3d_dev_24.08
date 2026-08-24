import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ProfileScreen } from "./profile.tsx";
import type { MarketModel, UserProfile } from "./models.ts";

const { getUserProfile, listModels, listAuthorFeed } = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  listModels: vi.fn(),
  listAuthorFeed: vi.fn(async () => ({ items: [], next_cursor: null })),
}));

vi.mock("./models.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models.ts")>()),
  getUserProfile,
  listModels,
}));
vi.mock("@domains/social/feed/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@domains/social/feed/api.ts")>()),
  listAuthorFeed,
}));

vi.mock("./ideas.ts", () => ({ listMyIdeas: vi.fn(async () => ({ items: [], next_cursor: null })) }));
vi.mock("./makes.ts", () => ({ listMyMakes: vi.fn(async () => ({ items: [], next_cursor: null })) }));
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header>Навигация</header> }));
vi.mock("./market.tsx", () => ({
  ModelTile: ({ model }: { model: MarketModel }) => <button type="button">{model.title}</button>,
}));
vi.mock("./accounteditor.tsx", () => ({ AccountEditor: () => <div>Редактор профиля</div> }));
vi.mock("./profile.catalogs.tsx", () => ({ MyCatalogsSection: () => null }));
vi.mock("./profile.push.tsx", () => ({ PushSettingsSection: () => null }));

const viewer = {
  id: "user-1",
  username: "maker",
  display_name: "Мастер",
  avatar_url: null,
  handle_confirmed: true,
  role: "user" as const,
};

const profile: UserProfile = {
  id: viewer.id,
  username: viewer.username,
  display_name: viewer.display_name,
  avatar_url: null,
  bio: null,
  website_url: null,
  contacts: [],
  models_count: 4,
  project_views_count: 0,
  project_downloads_count: 0,
  posts_count: 0,
  post_views_count: 0,
  post_score: 0,
  post_comments_count: 0,
  followers_count: 0,
  following_count: 0,
  is_following: false,
  badges: [],
  reputation_score: 0,
  trust_level: 0,
};

function model(index: number): MarketModel {
  return {
    id: `model-${index}`,
    title: `Проект ${index}`,
    description: null,
    status: "ready",
    source_format: "3mf",
    craft: "3d_printing",
    manufacturing_method: null,
    requires_ams: false,
    created_at: `2026-07-${String(18 - index).padStart(2, "0")}T10:00:00Z`,
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: null,
    owner: { id: viewer.id, username: viewer.username },
    project_summary: { file_count: 1, build_steps_count: 0 },
  };
}

function renderProfile(models: MarketModel[], currentUser = viewer, profileData: UserProfile = profile) {
  getUserProfile.mockResolvedValue(profileData);
  listModels.mockResolvedValue({ models, has_more: false, next_cursor: null });
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <ProfileScreen user={currentUser} section="market" onSectionChange={() => undefined} username={profileData.username} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("ProfileScreen project hierarchy", () => {
  it("shows four or more projects as an accessible carousel and scrolls it with the next control", async () => {
    const user = userEvent.setup();
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: scrollBy });
    renderProfile([model(1), model(2), model(3), model(4)]);

    const carousel = await screen.findByRole("region", { name: "Проекты пользователя" });
    expect(carousel.classList.contains("profileProjectCarousel")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Следующие проекты" }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number), behavior: "smooth" }));
  });

  it("keeps up to three projects in the regular grid without carousel controls", async () => {
    const { container } = renderProfile([model(1), model(2), model(3)]);
    await screen.findByRole("button", { name: "Проект 1" });

    expect(screen.queryByRole("region", { name: "Проекты пользователя" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующие проекты" })).toBeNull();
    expect(container.querySelector(".profileHeroCharacter svg")).toBeTruthy();
    expect(container.querySelector(".profileHeroCharacter img")).toBeNull();
  });

  it("uses a compact secondary add-project action instead of a large accent card", async () => {
    renderProfile([model(1)]);

    const action = await screen.findByRole("button", { name: "Добавить проект" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Проект 1" })).toBeTruthy());
    expect(action.classList.contains("profileAddProjectButton")).toBe(true);
    expect(action.classList.contains("uiActionCard")).toBe(false);
    expect(action.getAttribute("data-variant")).toBe("secondary");
  });

  it("keeps the public profile identical while exposing the private workshop only to its owner", async () => {
    const foreignViewer = { ...viewer, id: "viewer-2", username: "reader" };
    renderProfile([model(1)], foreignViewer);

    expect(await screen.findByRole("heading", { name: "Мастер" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подписаться" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Мастерская" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Редактировать профиль" })).toBeNull();
  });

  it("opens an addressable owner tab from the profile menu", async () => {
    window.history.replaceState(null, "", `/u/${viewer.username}?tab=workshop`);
    renderProfile([model(1)]);

    expect(await screen.findByRole("tab", { name: "Мастерская", selected: true })).toBeTruthy();
    expect(screen.getByText("Только для вас")).toBeTruthy();
  });
});
