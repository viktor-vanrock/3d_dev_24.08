import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Generation } from "./generations.ts";
import { GenerateScreen } from "./generatescreen.tsx";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function generation(status: Generation["status"]): Generation {
  return {
    id: "generation-1",
    branch: "openscad",
    prompt: "котик",
    params: {},
    status,
    preview_url: null,
    artifact_url: null,
    error: null,
    error_code: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
  };
}

function renderGenerateScreen(genId?: string) {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <GenerateScreen user={user} section="home" onSectionChange={() => {}} genId={genId} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GenerateScreen — завершение генерации", () => {
  it("после polling один раз пишет успешный generation_outcome", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const activationEvents: unknown[] = [];
    let generationReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/me/activation/events")) {
          activationEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 202 });
        }
        if (url.endsWith("/generations")) return new Response(JSON.stringify({ generations: [] }), { status: 200 });
        if (url.endsWith("/generations/generation-1")) {
          generationReads++;
          return new Response(JSON.stringify({ generation: generation(generationReads === 1 ? "queued" : "done") }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(
      <ThemeProvider>
        <OverlayProvider>
          <GenerateScreen user={user} section="home" onSectionChange={() => {}} genId="generation-1" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(activationEvents).toContainEqual({
      event_name: "generation_outcome",
      props: { generation_id: "generation-1", branch: "openscad", status: "done", error_code: null },
    });
    expect(activationEvents.filter((event) => (event as { event_name?: string }).event_name === "generation_outcome")).toHaveLength(1);
  });

  it("после polling пишет ошибочный generation_outcome с кодом", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const activationEvents: unknown[] = [];
    let generationReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/me/activation/events")) {
          activationEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 202 });
        }
        if (url.endsWith("/generations")) return new Response(JSON.stringify({ generations: [] }), { status: 200 });
        if (url.endsWith("/generations/generation-1")) {
          generationReads++;
          const result = generation(generationReads === 1 ? "queued" : "error");
          result.error_code = "timeout";
          return new Response(JSON.stringify({ generation: result }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(
      <ThemeProvider>
        <OverlayProvider>
          <GenerateScreen user={user} section="home" onSectionChange={() => {}} genId="generation-1" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(activationEvents).toContainEqual({
      event_name: "generation_outcome",
      props: { generation_id: "generation-1", branch: "openscad", status: "error", error_code: "timeout" },
    });
  });
});

describe("GenerateScreen — дизайн-ревью формы", () => {
  it("показывает понятное действие генерации вместо кнопки-звёздочки", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ generations: [] }), { status: 200 })));

    renderGenerateScreen();

    expect(screen.getByRole("button", { name: "Сгенерировать" }).textContent).toContain("Сгенерировать");
  });

  it("раскрывает дополнительные параметры и сообщает состояние скринридеру", async () => {
    const browser = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ generations: [] }), { status: 200 })));
    renderGenerateScreen();

    const toggle = screen.getByRole("button", { name: "Дополнительные параметры" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await browser.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("spinbutton", { name: "Целевой размер, мм" })).toBeTruthy();
  });

  it("во время генерации оставляет только выбранную ветку и не дублирует её в статусе", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/generations/generation-1")) {
          return new Response(JSON.stringify({ generation: generation("queued") }), { status: 200 });
        }
        return new Response(JSON.stringify({ generations: [] }), { status: 200 });
      }),
    );

    renderGenerateScreen("generation-1");
    await screen.findByText("В очереди");

    expect(screen.queryByRole("button", { name: "Чертёж КЗД" })).toBeNull();
    expect(screen.queryByRole("button", { name: "HueForge (много цветов)" })).toBeNull();
    expect(screen.queryByText("ветка: 3D-модель")).toBeNull();
  });
});

describe("GenerateScreen — история с веткой trellis", () => {
  // Регрессия живой находки 2026-07-20: GENERATION_BRANCHES/BRANCH_META не знали про trellis
  // (MF-2001 добавлен на бэкенде позже, фронт не обновили) — любая запись истории с
  // branch="trellis" и non-watertight результатом (preview_url=null, самый частый живой исход
  // этой ветки) валила весь экран `TypeError: Cannot read properties of undefined (reading
  // 'icon')` в HistoryThumb, без error boundary — воспроизведено вживую на dev.3mf.tech.
  it("рендерит историю с non-watertight trellis-генерацией без падения", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/generations")) {
          return new Response(
            JSON.stringify({
              generations: [
                {
                  id: "gen-trellis-1",
                  branch: "trellis",
                  prompt: "ажурная снежинка",
                  params: {},
                  status: "done",
                  preview_url: null,
                  artifact_url: "/generations/gen-trellis-1/artifact",
                  error: null,
                  error_code: null,
                  created_at: "2026-07-20T00:00:00Z",
                  updated_at: "2026-07-20T00:00:00Z",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderGenerateScreen();

    expect(await screen.findByText("ажурная снежинка")).toBeTruthy();
  });

  it("открывает готовый trellis GLB в настоящем 3D-вьюере", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/generations/gen-trellis-ready")) {
          return new Response(
            JSON.stringify({
              generation: {
                ...generation("done"),
                id: "gen-trellis-ready",
                branch: "trellis",
                prompt: "ваза с узором северных рун",
                preview_url: "/generations/gen-trellis-ready/preview",
                artifact_url: "/generations/gen-trellis-ready/artifact",
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/generations")) {
          return new Response(JSON.stringify({ generations: [] }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const { container } = renderGenerateScreen("gen-trellis-ready");

    expect(await screen.findByRole("button", { name: /Покрутить/u })).toBeTruthy();
    expect(container.querySelector(".modelViewerStage")).not.toBeNull();
    expect(container.querySelector(".generateImageFrame")).toBeNull();
  });
});
