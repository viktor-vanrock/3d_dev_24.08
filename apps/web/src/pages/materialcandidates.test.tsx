import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { MaterialCandidatesPage } from "./materialcandidates.tsx";

// MF-848: апрув-UI staging-очереди филамента — happy path (рендер списка, клик апрув/отклонить
// меняет статус), тот же приём мока fetch, что pages/catalogmetrics.test.tsx.

const CANDIDATE = {
  id: "cand-1",
  source: "spoolman",
  source_url: null,
  external_ref: "acme-pla-red",
  raw: { manufacturer: "Acme", material: "PLA", color_name: "Красный", diameter_mm: 1.75 },
  matched_material_id: null,
  confidence: 0.92,
  status: "pending",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const match = Object.keys(handlers).find((key) => url.includes(key));
      if (!match) return new Response(null, { status: 404 });
      return handlers[match]!(init);
    }),
  );
}

function renderPage() {
  return render(
    <OverlayProvider>
      <MaterialCandidatesPage />
    </OverlayProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MaterialCandidatesPage", () => {
  it("рендерит pending-кандидатов из очереди", async () => {
    mockFetch({
      "/material-candidates?status=pending": () => new Response(JSON.stringify({ candidates: [CANDIDATE], has_more: false }), { status: 200 }),
    });
    renderPage();
    expect(await screen.findByText("spoolman")).toBeTruthy();
    expect(screen.getByText(/acme-pla-red/)).toBeTruthy();
    expect(screen.getByText("уверенность 92%")).toBeTruthy();
    expect(screen.getByText(/"Acme"/)).toBeTruthy();
  });

  it("апрув убирает кандидата из списка", async () => {
    mockFetch({
      "/material-candidates?status=pending": () => new Response(JSON.stringify({ candidates: [CANDIDATE], has_more: false }), { status: 200 }),
      "/material-candidates/cand-1/approve": () =>
        new Response(JSON.stringify({ status: "merged", material_candidate_id: "cand-1", material_id: "m1", material_variant_id: "v1" }), {
          status: 200,
        }),
    });
    renderPage();
    await screen.findByText("spoolman");
    fireEvent.click(screen.getByText("Апрув"));
    await waitFor(() => expect(screen.queryByText("spoolman")).toBeNull());
  });

  it("отклонить требует подтверждения, затем убирает кандидата из списка", async () => {
    mockFetch({
      "/material-candidates?status=pending": () => new Response(JSON.stringify({ candidates: [CANDIDATE], has_more: false }), { status: 200 }),
      "/material-candidates/cand-1/reject": () => new Response(JSON.stringify({ status: "rejected", material_candidate_id: "cand-1" }), { status: 200 }),
    });
    renderPage();
    await screen.findByText("spoolman");
    fireEvent.click(screen.getByText("Отклонить"));
    fireEvent.click(await screen.findByText("Отклонить кандидата"));
    await waitFor(() => expect(screen.queryByText("spoolman")).toBeNull());
  });

  it("пустая очередь → EmptyState", async () => {
    mockFetch({
      "/material-candidates?status=pending": () => new Response(JSON.stringify({ candidates: [], has_more: false }), { status: 200 }),
    });
    renderPage();
    expect(await screen.findByText("Очередь пуста")).toBeTruthy();
  });

  it("ошибка запроса → сообщение вместо списка", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderPage();
    expect(await screen.findByText(/Не удалось загрузить очередь/)).toBeTruthy();
  });
});
