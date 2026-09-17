import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { NewsAdminEditor } from "./newseditor.tsx";

const api = vi.hoisted(() => ({ getAdminNews: vi.fn(), createAdminNews: vi.fn(), updateAdminNews: vi.fn(), publishAdminNews: vi.fn(), hideAdminNews: vi.fn() }));
vi.mock("./api.ts", () => api);
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header>Навигация</header> }));
vi.mock("../blockeditor.tsx", () => ({ FeedBlockEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Текст новости" value={value} onChange={(event) => onChange(event.target.value)} /> }));

const user = { id: "u1", username: "admin", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const, capabilities: ["data.news.manage" as const] };
const item = { id: "p1", title: "Scout draft", body: "Факты", status: "draft" as const, source: "scout" as const, source_url: "https://vendor.example/news", updated_at: "2026-09-14T12:00:00Z" };
const renderEditor = (id?: string) => render(<ThemeProvider><OverlayProvider><NewsAdminEditor user={user} section="feed" onSectionChange={() => undefined} id={id} /></OverlayProvider></ThemeProvider>);

afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.pushState(null, "", "/"); });

describe("NewsAdminEditor", () => {
  it("создаёт ручной draft", async () => {
    api.createAdminNews.mockResolvedValue({ ...item, id: "p2", title: "Ручная", source: "manual" });
    renderEditor(); const interaction = userEvent.setup();
    await interaction.type(screen.getByRole("textbox", { name: "Заголовок" }), "Ручная");
    await interaction.type(screen.getByRole("textbox", { name: "Текст новости" }), "Текст");
    await interaction.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(api.createAdminNews).toHaveBeenCalledWith({ title: "Ручная", body: "Текст" });
  });

  it("сохраняет правки Scout draft до публикации и показывает provenance", async () => {
    window.history.pushState(null, "", "/data/news/p1");
    api.getAdminNews.mockResolvedValue({ kind: "success", value: item }); api.updateAdminNews.mockResolvedValue(item); api.publishAdminNews.mockResolvedValue({ ...item, status: "published" });
    renderEditor("p1"); const interaction = userEvent.setup();
    expect(await screen.findByRole("link", { name: /Исходный источник/ })).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(api.updateAdminNews).toHaveBeenCalledWith("p1", { title: "Scout draft", body: "Факты" });
    expect(api.publishAdminNews).toHaveBeenCalledWith("p1");
    expect(api.updateAdminNews.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER).toBeLessThan(api.publishAdminNews.mock.invocationCallOrder[0] ?? 0);
    expect(window.location.pathname).toBe("/feed/p/p1");
  });

  it("остаётся в редакторе, если публикация не удалась", async () => {
    window.history.pushState(null, "", "/data/news/p1");
    api.getAdminNews.mockResolvedValue({ kind: "success", value: item }); api.updateAdminNews.mockResolvedValue(item); api.publishAdminNews.mockResolvedValue(null);
    renderEditor("p1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Опубликовать" }));
    expect(window.location.pathname).toBe("/data/news/p1");
  });

  it("сохраняет перед скрытием", async () => {
    api.getAdminNews.mockResolvedValue({ kind: "success", value: item }); api.updateAdminNews.mockResolvedValue(item); api.hideAdminNews.mockResolvedValue({ ...item, status: "hidden" });
    renderEditor("p1"); const interaction = userEvent.setup();
    await interaction.click(await screen.findByRole("button", { name: "Скрыть" }));
    expect(api.updateAdminNews).toHaveBeenCalled(); expect(api.hideAdminNews).toHaveBeenCalledWith("p1");
  });

  it("различает not found и сбой загрузки с retry", async () => {
    api.getAdminNews.mockResolvedValueOnce({ kind: "failure" }).mockResolvedValueOnce({ kind: "not_found" });
    renderEditor("p1");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Новость не найдена")).toBeTruthy();
  });

  it("отменяет detail request при unmount", () => {
    api.getAdminNews.mockImplementation((_id: string, signal: AbortSignal) => new Promise(() => { signal.addEventListener("abort", () => undefined); }));
    const view = renderEditor("p1");
    const signal = api.getAdminNews.mock.calls[0]?.[1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("сбрасывает pending после исключения при публикации", async () => {
    api.getAdminNews.mockResolvedValue({ kind: "success", value: item });
    api.updateAdminNews.mockRejectedValue(new Error("network"));
    renderEditor("p1");
    const publish = await screen.findByRole("button", { name: "Опубликовать" });
    await userEvent.setup().click(publish);
    expect(publish.hasAttribute("disabled")).toBe(false);
    expect(window.location.pathname).toBe("/");
  });
});
