import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { AccountEditor } from "./accounteditor.tsx";
import type { UserProfile } from "./models.ts";

// MF-357, Фаза 1 эпика MF-15 — секция редактора профиля (bio/website_url/contacts, PATCH /me).
// Персонаж настраивается единым mascot-редактором из капсулы, фото здесь не дублируется.

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    username: "tester",
    display_name: "Tester",
    avatar_url: null,
    bio: null,
    website_url: null,
    contacts: [],
    models_count: 0,
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
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { status = 200, body } = handler(String(input), init);
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
}

function renderEditor(profile: UserProfile, onSaved = vi.fn()) {
  render(
    <OverlayProvider>
      <AccountEditor profile={profile} onSaved={onSaved} />
    </OverlayProvider>,
  );
  return onSaved;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AccountEditor", () => {
  it("не предлагает отдельную фото-аватарку поверх mascot identity", () => {
    renderEditor(makeProfile({ avatar_url: "https://example.com/legacy-photo.png" }));

    expect(screen.queryByRole("button", { name: "Загрузить фото" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps the save action compact instead of stretching it across the profile", () => {
    renderEditor(makeProfile());

    expect(screen.getByRole("button", { name: "Сохранить" }).classList.contains("profileSaveButton")).toBe(true);
  });

  it("saves display_name/bio/website_url and calls onSaved with the patch", async () => {
    let sentBody: unknown;
    mockFetch((url, init) => {
      if (url.includes("/me") && init?.method === "PATCH") {
        sentBody = JSON.parse(String(init.body));
        return {
          body: {
            user: { id: "u1", username: "tester", display_name: "Новое имя", bio: "Новое био", website_url: "https://example.com", contacts: [] },
          },
        };
      }
      return { status: 404 };
    });

    const onSaved = renderEditor(makeProfile());

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Новое имя" } });
    fireEvent.change(screen.getByLabelText("О себе"), { target: { value: "Новое био" } });
    fireEvent.change(screen.getByLabelText("Сайт"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sentBody).toEqual({
      display_name: "Новое имя",
      bio: "Новое био",
      website_url: "https://example.com",
      contacts: [],
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Новое имя", bio: "Новое био", website_url: "https://example.com" }),
    );
  });

  it("shows a friendly error when the server rejects website_url", async () => {
    mockFetch((url, init) => {
      if (url.includes("/me") && init?.method === "PATCH") return { status: 400, body: { error: "invalid_website_url" } };
      return { status: 404 };
    });

    renderEditor(makeProfile());
    fireEvent.change(screen.getByLabelText("Сайт"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await screen.findByText("Ссылка на сайт должна начинаться с http:// или https://.");
  });

  it("adds and removes contact rows, capped at 5", async () => {
    renderEditor(makeProfile());

    const addButton = () => screen.getByRole("button", { name: "+ Добавить контакт" });
    for (let i = 0; i < 5; i++) {
      fireEvent.click(addButton());
    }
    expect(screen.queryByRole("button", { name: "+ Добавить контакт" })).toBeNull();
    expect(screen.getAllByLabelText("Удалить контакт")).toHaveLength(5);

    fireEvent.click(screen.getAllByLabelText("Удалить контакт")[0]!);
    expect(screen.getAllByLabelText("Удалить контакт")).toHaveLength(4);
    expect(addButton()).toBeTruthy();
  });

  it("filters out contacts left blank on save", async () => {
    let sentBody: { contacts?: unknown } | undefined;
    mockFetch((url, init) => {
      if (url.includes("/me") && init?.method === "PATCH") {
        sentBody = JSON.parse(String(init.body));
        return { body: { user: { id: "u1", username: "tester", display_name: null, bio: null, website_url: null, contacts: [] } } };
      }
      return { status: 404 };
    });

    renderEditor(makeProfile());
    fireEvent.click(screen.getByRole("button", { name: "+ Добавить контакт" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(sentBody).toBeDefined());
    expect(sentBody!.contacts).toEqual([]);
  });
});
