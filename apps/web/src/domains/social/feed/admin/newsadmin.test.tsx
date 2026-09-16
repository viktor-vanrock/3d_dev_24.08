import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@platform/theme";
import { OverlayProvider } from "@platform/overlay";
import { NewsAdminScreen } from "./newsadmin.tsx";

const api = vi.hoisted(() => ({ listAdminNews: vi.fn() }));
vi.mock("./api.ts", () => api);
vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header>Навигация</header> }));

afterEach(() => { cleanup(); api.listAdminNews.mockReset(); });

const user = { id: "u1", username: "admin", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const, capabilities: ["data.news.manage" as const] };

describe("NewsAdminScreen", () => {
  it("показывает ручные и Scout-черновики внутри DataShell", async () => {
    api.listAdminNews.mockResolvedValue({ kind: "success", value: [{ id: "p1", title: "Новый принтер", body: "Текст", status: "draft", source: "scout", source_url: "https://vendor.example/news", updated_at: "2026-09-14T12:00:00Z" }] });
    render(<ThemeProvider><OverlayProvider><NewsAdminScreen user={user} section="feed" onSectionChange={() => undefined} /></OverlayProvider></ThemeProvider>);
    expect(await screen.findByRole("navigation", { name: "Разделы данных" })).toBeTruthy();
    expect(await screen.findByText("Новый принтер")).toBeTruthy();
    expect(screen.getAllByText("Scout")).toHaveLength(2);
  });

  it("показывает ошибку запроса и позволяет повторить", async () => {
    api.listAdminNews.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ kind: "success", value: [] });
    render(<ThemeProvider><OverlayProvider><NewsAdminScreen user={user} section="feed" onSectionChange={() => undefined} /></OverlayProvider></ThemeProvider>);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Новостей нет")).toBeTruthy();
    expect(api.listAdminNews).toHaveBeenCalledTimes(2);
  });

  it("отменяет старый запрос при смене фильтра и не показывает stale ответ", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    api.listAdminNews
      .mockImplementationOnce((_filters, signal: AbortSignal) => new Promise((resolve) => { resolveFirst = resolve; signal.addEventListener("abort", () => undefined); }))
      .mockResolvedValueOnce({ kind: "success", value: [{ id: "new", title: "Актуальная", body: null, status: "draft", source: "manual", source_url: null, updated_at: "2026-09-14T12:00:00Z" }] });
    const view = render(<ThemeProvider><OverlayProvider><NewsAdminScreen user={user} section="feed" onSectionChange={() => undefined} /></OverlayProvider></ThemeProvider>);
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Статус" }), "draft");
    expect(await screen.findByText("Актуальная")).toBeTruthy();
    const firstSignal = api.listAdminNews.mock.calls[0]?.[1];
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.({ kind: "success", value: [{ id: "old", title: "Устаревшая", body: null, status: "draft", source: "manual", source_url: null, updated_at: "2026-09-14T11:00:00Z" }] });
    await waitFor(() => expect(screen.queryByText("Устаревшая")).toBeNull());
    view.unmount();
    expect(api.listAdminNews.mock.calls[1]?.[1]?.aborted).toBe(true);
  });

  it("не запрашивает очередь и показывает отказ без capability", () => {
    render(<ThemeProvider><OverlayProvider><NewsAdminScreen user={{ ...user, capabilities: [] }} section="feed" onSectionChange={() => undefined} /></OverlayProvider></ThemeProvider>);
    expect(screen.getByText("Недостаточно прав")).toBeTruthy();
    expect(api.listAdminNews).not.toHaveBeenCalled();
  });
});
