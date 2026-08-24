import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { IdeaScreen } from "./ideascreen.tsx";

// Страница идеи `/issue/:id` (docs/design/ideas.md §3, MF-946) — фетч-моки тем же приёмом, что
// app.test.tsx: подменяем global fetch по подстроке URL.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const match = Object.keys(routes).find((key) => url.includes(key));
      if (!match) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(routes[match]), { status: 200 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderIdea(id: string) {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <IdeaScreen user={user} section="market" onSectionChange={() => {}} id={id} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

const baseIdea = {
  id: "idea-1",
  author_id: "u1",
  title: "Фильтр каталога по цвету",
  body: "Хотим фильтр по цвету в каталоге.",
  category: "catalog",
  type: "idea",
  status: "under_review",
  canonical_id: null,
  vote_count: 5,
  decline_reason: null,
  created_at: new Date().toISOString(),
  last_activity_at: new Date().toISOString(),
  viewer_has_voted: false,
  comments: [],
};

describe("IdeaScreen (MF-946)", () => {
  it("рендерит заголовок, статус-пилюлю и крупную голосовалку", async () => {
    mockFetch({ "/ideas/idea-1": { ...baseIdea, author_id: "someone-else" } });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getByText("Фильтр каталога по цвету")).toBeTruthy());
    expect(screen.getByText("На рассмотрении")).toBeTruthy();
    expect(screen.getByText(/Голосовать/)).toBeTruthy();
  });

  it("своя идея → голосовалка заменена подписью «Ваша идея»", async () => {
    mockFetch({ "/ideas/idea-1": baseIdea });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getByText("Ваша идея")).toBeTruthy());
    expect(screen.queryByText("Голосовать")).toBeNull();
  });

  it("отклонена → рендерит блок публичной причины", async () => {
    mockFetch({ "/ideas/idea-1": { ...baseIdea, author_id: "someone-else", status: "declined", decline_reason: "Дублирует существующую фичу" } });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getAllByText("Отклонена").length).toBeGreaterThan(0));
    expect(screen.getByText("Дублирует существующую фичу")).toBeTruthy();
  });

  it("дубликат → ссылка на каноническую идею", async () => {
    mockFetch({
      "/ideas/idea-1": { ...baseIdea, author_id: "someone-else", status: "duplicate", canonical_id: "idea-orig", decline_reason: "Уже предлагали" },
    });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getByText("Дубликат идеи")).toBeTruthy());
    const link = screen.getByText(/Смотреть оригинал/) as HTMLAnchorElement;
    expect(link.closest("a")?.getAttribute("href")).toBe("/issue/idea-orig");
  });

  it("пустой тред → «Пока нет обсуждения. Будьте первым»", async () => {
    mockFetch({ "/ideas/idea-1": baseIdea });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getByText("Пока нет обсуждения. Будьте первым")).toBeTruthy());
  });

  it("404/ошибка загрузки → «Идея не найдена» + «Повторить»", async () => {
    mockFetch({});
    renderIdea("does-not-exist");
    await waitFor(() => expect(screen.getByText("Идея не найдена")).toBeTruthy());
    expect(screen.getByText("Повторить")).toBeTruthy();
  });

  it("type=problem (MF-694, §4.2) → ProblemTag вместо статус-пилюли, голосовалка скрыта", async () => {
    mockFetch({ "/ideas/idea-1": { ...baseIdea, author_id: "someone-else", type: "problem" } });
    renderIdea("idea-1");
    await waitFor(() => expect(screen.getByText("Проблема")).toBeTruthy());
    expect(screen.queryByText("На рассмотрении")).toBeNull();
    expect(screen.queryByText(/Голосовать/)).toBeNull();
  });
});
