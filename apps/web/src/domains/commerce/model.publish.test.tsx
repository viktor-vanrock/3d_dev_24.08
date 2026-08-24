import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ModelScreen } from "./model.tsx";

// Кнопка публикации/распубликования (MF-341, Фаза 3): PATCH /models/:id { publish_status }
// (API готов — MF-340). Владелец видит «Опубликовать» на черновике и «Снять с публикации»
// на опубликованном; действие переключает и обновляет и кнопку, и бейдж «Черновик».

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "Тестовая модель",
    description: null,
    status: "ready",
    publish_status: "published",
    source_format: "stl",
    craft: "3d_printing",
    created_at: "2026-07-01T00:00:00Z",
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: null,
    bbox: null,
    size_bytes: null,
    my_vote: 0,
    preview_url: null,
    preview_mobile_url: null,
    download_url: null,
    files: [],
    repo_url: null,
    recommended_material: null,
    owner: { id: "u1", username: "tester", display_name: null, avatar_url: null },
    make_stats: { makes_count: 0, machines_count: 0, materials_count: 0, avg_printability_rating: null },
    top_combos: [],
    ...overrides,
  };
}

function mockFetch(model: ReturnType<typeof baseModel>, patchResponse: { status: number } = { status: 200 }) {
  const patchCalls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH" && url.includes("/models/m1")) {
        patchCalls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        if (patchResponse.status >= 400) return new Response(JSON.stringify({ error: "forbidden" }), { status: patchResponse.status });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/models/m1/comments")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes("/models/m1")) return new Response(JSON.stringify({ model }), { status: 200 });
      return new Response(null, { status: 404 });
    }),
  );
  return patchCalls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderModel() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <ModelScreen user={user} section="market" onSectionChange={() => {}} id="m1" tab="comments" />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("ModelScreen — публикация/распубликация владельцем", () => {
  it("опубликованный проект показывает «Снять с публикации», без бейджа «Черновик»", async () => {
    mockFetch(baseModel({ publish_status: "published" }));
    renderModel();

    expect(await screen.findByRole("button", { name: "Снять с публикации" })).toBeTruthy();
    expect(screen.queryByText("Черновик")).toBeNull();
  });

  it("черновик показывает бейдж «Черновик» и кнопку «Опубликовать»; клик публикует", async () => {
    mockFetch(baseModel({ publish_status: "draft" }));
    renderModel();

    expect(await screen.findByText("Черновик")).toBeTruthy();
    const button = await screen.findByRole("button", { name: "Опубликовать" });

    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Снять с публикации" })).toBeTruthy();
    expect(screen.queryByText("Черновик")).toBeNull();
  });

  it("клик по «Снять с публикации» шлёт PATCH publish_status=draft и переключает кнопку/бейдж обратно", async () => {
    const patchCalls = mockFetch(baseModel({ publish_status: "published" }));
    renderModel();

    const button = await screen.findByRole("button", { name: "Снять с публикации" });
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Опубликовать" })).toBeTruthy();
    expect(await screen.findByText("Черновик")).toBeTruthy();
    expect(patchCalls).toEqual([{ url: expect.stringContaining("/models/m1"), body: { publish_status: "draft" } }]);
  });

  it("отказ API (гейт владения импорта) не меняет кнопку и показывает тост об ошибке", async () => {
    mockFetch(baseModel({ publish_status: "draft" }), { status: 403 });
    renderModel();

    const button = await screen.findByRole("button", { name: "Опубликовать" });
    fireEvent.click(button);

    expect(await screen.findByText("Не удалось опубликовать")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Опубликовать" })).toBeTruthy();
  });

  it("чужому посетителю кнопка публикации и бейдж «Черновик» не показываются", async () => {
    mockFetch(baseModel({ publish_status: "draft", owner: { id: "other", username: "other", display_name: null, avatar_url: null } }));
    renderModel();

    await screen.findByRole("heading", { name: "Тестовая модель", level: 1 });
    expect(screen.queryByRole("button", { name: "Опубликовать" })).toBeNull();
    expect(screen.queryByText("Черновик")).toBeNull();
  });
});
