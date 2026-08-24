import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowConcept } from "./conceptflow.ts";
import { ConceptTile } from "./concepttile.tsx";

const baseConcept: FlowConcept = {
  id: "variant-vase",
  conceptId: null,
  generationId: null,
  label: "Ваза с узором из котиков",
  prompt: "Керамическая ваза с круговым узором из силуэтов котиков",
  motif: "decor",
  previewUrl: null,
  state: "queued",
  arrival: "prompt",
  trellisStatus: null,
  trellisProgress: null,
  trellisEtaSeconds: null,
  trellisEstimateAt: null,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConceptTile motion states", () => {
  it("помечает только что придуманную Gemma карточку отдельной анимацией", () => {
    const { container } = render(
      <ConceptTile concept={baseConcept} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    expect(container.querySelector(".homeConceptTile--prompt-enter")).not.toBeNull();
    expect(container.querySelector(".homeConceptTile--queued")).not.toBeNull();
    expect(container.querySelector(".homeConceptQueueCue")?.textContent).toContain("В очереди");
    expect(container.querySelector(".homeConceptTile--image-enter")).toBeNull();
    expect(container.querySelector(".homeConceptDescription")?.textContent).toBe(baseConcept.prompt);
  });

  it("проявляет готовый Z-Image отдельно от появления промпта", () => {
    const generated: FlowConcept = {
      ...baseConcept,
      conceptId: "concept-vase",
      generationId: "generation-vase",
      previewUrl: "/concepts/concept-vase/preview",
      state: "ready",
      arrival: "image",
    };
    const { container } = render(
      <ConceptTile concept={generated} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );
    const image = container.querySelector("img");

    expect(container.querySelector(".homeConceptTile--image-enter")).not.toBeNull();
    expect(container.querySelector(".homeConceptTile--prompt-enter")).toBeNull();
    fireEvent.load(image!);
    expect(image?.hasAttribute("data-loaded")).toBe(true);
    expect(container.querySelector(".homeConceptVisual")?.hasAttribute("data-loaded")).toBe(true);
  });

  it("проявляет уже загруженный из browser cache PNG без гонки с effect", async () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1024);
    const generated: FlowConcept = {
      ...baseConcept,
      conceptId: "concept-cached-image",
      generationId: "generation-cached-image",
      previewUrl: "/concepts/concept-cached-image/preview",
      state: "ready",
      arrival: "cached",
    };
    const { container } = render(
      <ConceptTile concept={generated} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    await waitFor(() => expect(container.querySelector("img")?.hasAttribute("data-loaded")).toBe(true));
    complete.mockRestore();
    naturalWidth.mockRestore();
  });

  it("показывает активное движение только на текущей Z-Image карточке", () => {
    const generating: FlowConcept = {
      ...baseConcept,
      state: "generating",
    };
    const { container } = render(
      <ConceptTile concept={generating} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    expect(container.querySelector(".homeConceptTile--generating")).not.toBeNull();
    expect(container.querySelector(".homeConceptTile--queued")).toBeNull();
    expect(container.querySelector(".homeConceptGenerationCue")?.textContent).toContain("Создаём изображение");
  });

  it("не выдаёт карточку из постоянного кэша за новую генерацию", () => {
    const cached: FlowConcept = {
      ...baseConcept,
      id: "cache-vase",
      conceptId: "concept-vase",
      generationId: "generation-vase",
      previewUrl: "/concepts/concept-vase/preview",
      state: "ready",
      arrival: "cached",
    };
    const { container } = render(
      <ConceptTile concept={cached} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    expect(container.querySelector(".homeConceptTile--prompt-enter")).toBeNull();
    expect(container.querySelector(".homeConceptTile--image-enter")).toBeNull();
  });

  it("показывает серверный ETA как обратный отсчёт и анимируемый прогресс", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00Z"));
    const running: FlowConcept = {
      ...baseConcept,
      conceptId: "concept-vase",
      generationId: "trellis-vase",
      previewUrl: "/concepts/concept-vase/preview",
      state: "ready",
      arrival: "cached",
      trellisStatus: "running",
      trellisProgress: 42,
      trellisEtaSeconds: 125,
      trellisEstimateAt: Date.now(),
    };
    const { container } = render(
      <ConceptTile concept={running} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    expect(container.querySelector(".homeConceptTrellisEta")?.textContent).toBe("02:05");
    expect(container.querySelector(".homeConceptTrellisEta")?.getAttribute("datetime")).toBe("PT125S");
    expect(container.querySelector(".homeConceptTrellisActivity")).toBeTruthy();
    expect(container.querySelector(".homeConceptTrellisTrack i")?.getAttribute("style")).toContain("42%");

    act(() => vi.advanceTimersByTime(1_000));
    expect(container.querySelector(".homeConceptTrellisEta")?.textContent).toBe("02:04");
    expect(container.querySelector(".homeConceptTrellisEta")?.getAttribute("datetime")).toBe("PT124S");
  });

  it("не показывает —:—, пока TRELLIS только запускается", () => {
    const starting: FlowConcept = {
      ...baseConcept,
      conceptId: "concept-vase",
      generationId: "trellis-vase",
      previewUrl: "/concepts/concept-vase/preview",
      state: "ready",
      arrival: "cached",
      trellisStatus: "starting",
      trellisProgress: null,
      trellisEtaSeconds: 240,
      trellisEstimateAt: Date.now(),
    };
    const { container } = render(
      <ConceptTile concept={starting} index={0} onSelect={vi.fn()} onVisibilityChange={vi.fn()} />,
    );

    expect(container.querySelector(".homeConceptTrellisEta")?.textContent).toMatch(/^0[34]:\d{2}$/u);
    expect(container.textContent).not.toContain("—:—");
  });
});
