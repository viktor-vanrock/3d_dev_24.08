import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { FeedEditorScreen } from "./editor.tsx";
import type { FeedCommunityOption } from "./api.ts";

const apiMocks = vi.hoisted(() => ({
  createFeedPost: vi.fn(),
  listMyCommunities: vi.fn(async (): Promise<FeedCommunityOption[]> => []),
}));
const eventMocks = vi.hoisted(() => ({
  trackFeedEvent: vi.fn(),
}));

vi.mock("./api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.ts")>()),
  createFeedPost: apiMocks.createFeedPost,
  listMyCommunities: apiMocks.listMyCommunities,
}));
vi.mock("./events.ts", () => ({ trackFeedEvent: eventMocks.trackFeedEvent }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  apiMocks.createFeedPost.mockReset();
  apiMocks.listMyCommunities.mockClear();
  eventMocks.trackFeedEvent.mockClear();
});

const user = {
  id: "u1",
  username: "maker",
  display_name: null,
  avatar_url: null,
  handle_confirmed: true,
  role: "user" as const,
};

function renderEditor() {
  render(
    <ThemeProvider>
      <OverlayProvider>
        <FeedEditorScreen user={user} section="feed" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("FeedEditorScreen — ограничение текста", () => {
  it("объясняет лимит текста до ввода, а не только счётчиком байтов", () => {
    renderEditor();

    expect(screen.getByText("0 из 50 КБ текста" )).toBeTruthy();
  });
});

describe("FeedEditorScreen — дизайн-ревью MF-1752", () => {
  it("показывает выбранный саб как контекст редактора", async () => {
    apiMocks.listMyCommunities.mockResolvedValueOnce([
      { id: "c1", slug: "printing", name: "3D-печать", kind: "craft" },
    ]);
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.selectOptions(await screen.findByRole("combobox", { name: "Куда публикуем" }), "c1");

    expect(screen.getAllByText("3D-печать")).toHaveLength(2);
    expect(screen.getByText("Сообщество · от @maker")).toBeTruthy();
  });

  it("оставляет явным место публикации и не показывает отдельный предпросмотр", () => {
    renderEditor();

    expect(screen.getByRole("combobox", { name: "Куда публикуем" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "В мой профиль" })).toBeTruthy();
    expect(screen.queryByText("Так это увидят в ленте")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Тип публикации" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Подсказки к публикации" })).toBeTruthy();
  });

  it("после попытки публикации связывает доступную ошибку с обязательным заголовком", async () => {
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.click(screen.getByRole("button", { name: "Опубликовать" }));

    const title = screen.getByRole("textbox", { name: "Заголовок *" });
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe("feed-editor-title-error");
    expect(screen.getByRole("alert").textContent).toBe("Заполните заголовок");
    expect(document.activeElement).toBe(title);
    expect(apiMocks.createFeedPost).not.toHaveBeenCalled();
  });

  it("добавляет типизированный блок и отправляет его в совместимом Markdown-формате", async () => {
    const interaction = userEvent.setup();
    apiMocks.createFeedPost.mockResolvedValue({
      id: "post-1",
      title: "Полезный пост",
    });
    renderEditor();

    await interaction.type(screen.getByRole("textbox", { name: "Заголовок *" }), "Полезный пост");
    await interaction.type(screen.getByRole("textbox", { name: "Текст 1" }), "Вводный абзац");
    await interaction.click(screen.getByRole("button", { name: "Добавить блок" }));
    await interaction.click(screen.getByRole("menuitem", { name: "Подзаголовок 2" }));
    await interaction.type(screen.getByRole("textbox", { name: "Подзаголовок 2 2" }), "Настройки");
    await interaction.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(apiMocks.createFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Полезный пост",
        body: "Вводный абзац\n\n## Настройки",
      }),
    );
  });

  it("не считает пустой типизированный блок содержимым поста", async () => {
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.type(screen.getByRole("textbox", { name: "Заголовок *" }), "Только заголовок");
    await interaction.click(screen.getByRole("button", { name: "Добавить блок" }));
    await interaction.click(screen.getByRole("menuitem", { name: "Подзаголовок 2" }));
    await interaction.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(screen.getByText("Добавьте текст или вложение")).toBeTruthy();
    expect(apiMocks.createFeedPost).not.toHaveBeenCalled();
  });
});

describe("FeedEditorScreen телеметрия (MF-980)", () => {
  it("шлёт feed_post_draft_start один раз на первый keystroke заголовка, не на каждую букву", async () => {
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.type(screen.getByRole("textbox", { name: "Заголовок *" }), "Полезный пост");

    expect(eventMocks.trackFeedEvent).toHaveBeenCalledTimes(1);
    expect(eventMocks.trackFeedEvent).toHaveBeenCalledWith("feed_post_draft_start", { community_id: null });
  });

  it("шлёт feed_post_draft_start на первый ввод тела, если заголовок ещё не тронут", async () => {
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.type(screen.getByRole("textbox", { name: "Текст 1" }), "Вводный абзац");

    expect(eventMocks.trackFeedEvent).toHaveBeenCalledTimes(1);
    expect(eventMocks.trackFeedEvent).toHaveBeenCalledWith("feed_post_draft_start", { community_id: null });
  });

  it("не шлёт feed_post_draft_start повторно, когда заголовок и тело оба тронуты", async () => {
    const interaction = userEvent.setup();
    renderEditor();

    await interaction.type(screen.getByRole("textbox", { name: "Заголовок *" }), "Заголовок");
    await interaction.type(screen.getByRole("textbox", { name: "Текст 1" }), "Тело");

    expect(eventMocks.trackFeedEvent).toHaveBeenCalledTimes(1);
  });
});
