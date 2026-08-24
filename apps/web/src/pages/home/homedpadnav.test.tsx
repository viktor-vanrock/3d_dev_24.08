import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MarketModel } from "@domains/commerce";
import { OverlayProvider } from "@platform/overlay";
import { initInputMode, ThemeProvider } from "@platform/theme";
import { HomeScreen } from "./home.tsx";

// Фокус пультом на Доме (home.visual.md §10, tv.10foot.md §9, MF-923) — вход при уже включённом
// dpad-режиме, порядок первая плитка → чипы → поле → искра, симуляция через fireEvent.keyDown.

const user = { id: "u1", username: "tester", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function model(id: string, title: string): MarketModel {
  return {
    id,
    title,
    description: null,
    status: "ready",
    source_format: "stl",
    craft: "3d_printing",
    manufacturing_method: null,
    requires_ams: false,
    created_at: "2026-01-01T00:00:00Z",
    votes_up: 0,
    votes_down: 0,
    downloads_count: 0,
    tags: [],
    thumb_url: `/models/${id}/thumbnail`,
    owner: { id: "o1", username: "author" },
    project_summary: { file_count: 1, build_steps_count: 0 },
  };
}

const POPULAR_MODELS = Array.from({ length: 5 }, (_, i) => model(`pop-${i}`, `Популярная модель ${i}`));

function mockFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
      if (url.includes("/models")) {
        const parsed = new URL(url, "http://localhost");
        const sort = parsed.searchParams.get("sort");
        const models = sort === "new" ? [] : POPULAR_MODELS;
        return new Response(JSON.stringify({ models, has_more: false, next_cursor: null }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  // inputmode хранит последний способ ввода в module-scope; очистки data-атрибута недостаточно,
  // иначе dpad-состояние протекает из соседнего тестового файла в mouse/touch-сценарий.
  fireEvent.pointerDown(document);
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.inputMode;
});

function renderHome() {
  return render(
    <ThemeProvider>
      <OverlayProvider>
        <HomeScreen user={user} section="home" onSectionChange={() => {}} />
      </OverlayProvider>
    </ThemeProvider>,
  );
}

describe("фокус пультом на Доме", () => {
  it("вход уже в dpad-режиме → фокус на первой плитке первой полки, не на поле ввода", async () => {
    initInputMode();
    fireEvent.keyDown(document, { key: "ArrowDown" }); // до монтирования — как «пульт уже нажимали»
    mockFetch();
    renderHome();

    await screen.findByText("Популярно сейчас · Печатают чаще всего");
    await waitFor(() => expect(document.activeElement?.className).toContain("homeModelTile"));
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText("Найти или создать модель"));
  });

  it("вход мышью/тачем (без dpad) — автофокус не трогает плитку", async () => {
    mockFetch();
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    expect(document.activeElement?.className ?? "").not.toContain("homeModelTile");
  });

  it("↑ с первой плитки уводит на чипы, ↑ ещё раз — на поле ввода", async () => {
    mockFetch();
    renderHome();
    await screen.findByText("Популярно сейчас · Печатают чаще всего");

    await waitFor(() => expect(document.querySelector(".homeModelTile")).toBeTruthy());
    const tile = document.querySelector<HTMLElement>(".homeModelTile");
    expect(tile).toBeTruthy();
    tile!.focus();

    fireEvent.keyDown(tile!, { key: "ArrowUp" });
    expect(document.activeElement?.className).toContain("homeHintChip");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Найти или создать модель"));
  });
});
