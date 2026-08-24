import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { HomeScreen } from "./home.tsx";

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function renderHome() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <HomeScreen user={user} section="home" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("события активации дома", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("один раз пишет home_view с состоянием возвращающегося пользователя", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/me/activation/events")) {
          activationEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 202 });
        }
        if (url.includes("/me/activation")) {
          return new Response(
            JSON.stringify({
              activation: {
                state: "returning",
                has_printer: true,
                primary_persona: null,
                home_tier: "auto",
                activation_checklist: {},
                home_dismissed_prompts: {},
              },
              printers: [],
              filaments: [],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/models")) return new Response(JSON.stringify({ models: [], has_more: false, next_cursor: null }), { status: 200 });
        if (url.includes("/concepts?")) {
          return new Response(JSON.stringify({
            concepts: [{
              id: "00000000-0000-4000-8000-000000000001",
              generation_id: "00000000-0000-4000-8000-000000000002",
              label: "котик в минималистичном стиле",
              prompt: "котик в минималистичном стиле, product shot",
              motif: "figure",
              preview_url: "/concepts/00000000-0000-4000-8000-000000000001/preview",
              reuse_count: 1,
              score: 0.9,
              status: "ready",
            }],
            degraded: false,
          }), { status: 200 });
        }
        if (url.endsWith("/assistant/prompt-variants")) {
          return new Response(JSON.stringify({ variants: [] }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderHome();

    await screen.findByRole("textbox", { name: "Найти или создать модель" });
    await waitFor(() => expect(activationEvents).toContainEqual({ event_name: "home_view", props: { state: "returning" } }));
  });

  it("пишет текст выбранной подсказки", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/me/activation/events")) {
          activationEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 202 });
        }
        if (url.includes("/me/activation")) {
          return new Response(
            JSON.stringify({
              activation: {
                state: "returning",
                has_printer: true,
                primary_persona: null,
                home_tier: "auto",
                activation_checklist: {},
                home_dismissed_prompts: {},
              },
              printers: [],
              filaments: [],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/models")) return new Response(JSON.stringify({ models: [], has_more: false, next_cursor: null }), { status: 200 });
        return new Response(null, { status: 404 });
      }),
    );

    renderHome();

    fireEvent.click(await screen.findByRole("button", { name: "котик в шлеме" }));
    await waitFor(() => expect(activationEvents).toContainEqual({ event_name: "home_hint_chip_click", props: { text: "котик в шлеме" } }));
  });

  it("пишет длину непустого промпта при отправке из hero", async () => {
    const activationEvents: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/me/activation/events")) {
          activationEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 202 });
        }
        if (url.includes("/me/activation")) {
          return new Response(
            JSON.stringify({
              activation: {
                state: "returning",
                has_printer: true,
                primary_persona: null,
                home_tier: "auto",
                activation_checklist: {},
                home_dismissed_prompts: {},
              },
              printers: [],
              filaments: [],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/models")) return new Response(JSON.stringify({ models: [], has_more: false, next_cursor: null }), { status: 200 });
        if (url.includes("/concepts?")) {
          return new Response(JSON.stringify({
            concepts: [{
              id: "00000000-0000-4000-8000-000000000001",
              generation_id: "00000000-0000-4000-8000-000000000002",
              label: "котик в минималистичном стиле",
              prompt: "котик в минималистичном стиле, product shot",
              motif: "figure",
              preview_url: "/concepts/00000000-0000-4000-8000-000000000001/preview",
              reuse_count: 1,
              score: 0.9,
              status: "ready",
            }],
            degraded: false,
          }), { status: 200 });
        }
        if (url.endsWith("/assistant/prompt-variants")) {
          return new Response(JSON.stringify({ variants: [] }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    renderHome();

    fireEvent.change(await screen.findByRole("textbox", { name: "Найти или создать модель" }), { target: { value: "котик" } });
    fireEvent.click(await screen.findByRole("button", { name: "Создать 3D: котик в минималистичном стиле" }));
    await waitFor(() =>
      expect(activationEvents).toContainEqual({
        event_name: "home_hero_submit",
        props: expect.objectContaining({ source: "generation_concept" }),
      }),
    );
  });
});
