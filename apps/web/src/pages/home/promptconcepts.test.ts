import { describe, expect, it } from "vitest";
import {
  buildPromptConcepts,
  displayConceptDescription,
  displayConceptLabel,
  FUNCTIONAL_PROMPT_GUARD_MARKER,
  strengthenPromptForQuery,
} from "./promptconcepts.ts";

describe("buildPromptConcepts", () => {
  it("keeps the concept grid populated with six distinct prompts when the API is unavailable", () => {
    const concepts = buildPromptConcepts("  ваза   с узором  ");

    expect(concepts).toHaveLength(6);
    expect(new Set(concepts.map((concept) => concept.label))).toHaveProperty("size", 6);
    expect(new Set(concepts.map((concept) => concept.prompt))).toHaveProperty("size", 6);
    expect(concepts.every((concept) => concept.label.startsWith("Ваза с узором "))).toBe(true);
    expect(concepts.some((concept) => concept.label === "Ваза с узором из силуэтов котиков")).toBe(true);
    expect(concepts.every((concept) => concept.prompt.toLocaleLowerCase("ru").includes("ваза с узором"))).toBe(true);
  });

  it("does not create concepts for an empty or punctuation-only query", () => {
    expect(buildPromptConcepts("  ")).toEqual([]);
    expect(buildPromptConcepts("---")).toEqual([]);
  });

  it("перерабатывает сюжетный запрос в разные физические модели, а не суффиксы", () => {
    const query = "Кот на скейте делает бэкфлип над вулканом";
    const concepts = buildPromptConcepts(query);

    expect(concepts).toHaveLength(6);
    expect(concepts.every((concept) => !concept.label.startsWith(query))).toBe(true);
    expect(concepts.map((concept) => concept.label)).toEqual([
      "Сценическая миниатюра «Кот на скейте»",
      "Рельефный момент «Кот на скейте»",
      "Кинетический тотем «Кот на скейте»",
      "Шарнирная фигурка «Кот на скейте»",
      "Силуэтная траектория «Кот на скейте»",
      "Настольная сцена «Кот на скейте»",
    ]);
    expect(new Set(concepts.map((concept) => concept.motif)).size).toBeGreaterThan(2);
    expect(
      concepts.every((concept) => concept.prompt.includes("Кот на скейте делает бэкфлип")),
    ).toBe(true);

    const inflectedAction = buildPromptConcepts(
      "Лиса на моноколесе перепрыгивает ледяную арку",
    );
    expect(inflectedAction[0]?.label).toBe(
      "Сценическая миниатюра «Лиса на моноколесе»",
    );
    expect(inflectedAction.every((concept) => concept.prompt.includes("ледяную арку"))).toBe(true);
  });

  it("не ослабляет функциональный объект даже при сюжетном предлоге", () => {
    const concepts = buildPromptConcepts("держатель телефона над столом");

    expect(concepts.every((concept) => concept.prompt.includes(FUNCTIONAL_PROMPT_GUARD_MARKER))).toBe(true);
    expect(concepts.every((concept) => concept.label.toLocaleLowerCase("ru").includes("держатель"))).toBe(true);
  });

  it("keeps a functional holder as the primary image subject", () => {
    const concepts = buildPromptConcepts("держатель наушников");

    expect(concepts).toHaveLength(6);
    expect(
      concepts.every((concept) => concept.prompt.includes(FUNCTIONAL_PROMPT_GUARD_MARKER)),
    ).toBe(true);
    expect(concepts.every((concept) => concept.prompt.includes("без предмета"))).toBe(true);
    expect(
      strengthenPromptForQuery("ваза с узором", "Ваза с рельефом"),
    ).toBe("Ваза с рельефом");
  });

  it("keeps later fallback batches creative and unique", () => {
    const firstContinuation = buildPromptConcepts("ваза с узором", 1);
    const secondContinuation = buildPromptConcepts("ваза с узором", 2);

    expect(firstContinuation).toHaveLength(6);
    expect(secondContinuation).toHaveLength(6);
    expect(firstContinuation[0]?.label).toBe("Ваза с узором с солнечными знаками майя");
    expect(new Set([...firstContinuation, ...secondContinuation].map((concept) => concept.prompt)).size).toBe(12);
    expect([...firstContinuation, ...secondContinuation].every((concept) => !concept.label.includes("серия"))).toBe(true);

    const later = buildPromptConcepts("ваза с узором", 3);
    expect(later[0]?.label).toContain("в спиральном ритме");
    expect(new Set([...firstContinuation, ...secondContinuation, ...later].map((concept) => concept.label)).size).toBe(18);
  });

  it("does not exhaust the fallback after the first 24 continuation batches", () => {
    const longFeed = Array.from({ length: 40 }, (_, index) =>
      buildPromptConcepts("кашпо", index + 1),
    ).flat();

    expect(longFeed).toHaveLength(240);
    expect(new Set(longFeed.map((concept) => concept.label))).toHaveProperty("size", 240);
    expect(new Set(longFeed.map((concept) => concept.prompt))).toHaveProperty("size", 240);
    expect(longFeed.every((concept) => !concept.label.includes("серия"))).toBe(true);
    expect(longFeed.some((concept) => concept.label.includes("тонкими рёбрами"))).toBe(true);
    expect(
      longFeed.every(
        (concept) => !/(глин|металл|фарфор|дерев|стекл|цветн)/iu.test(concept.prompt),
      ),
    ).toBe(true);
  });

  it("hides legacy batch numbering from cached and generated labels", () => {
    expect(displayConceptLabel("ваза с узором · Механический рой · серия 8")).toBe(
      "ваза с узором · Механический рой",
    );
    expect(displayConceptLabel("Облака и журавли — серия 12")).toBe("Облака и журавли");
  });

  it("shows the unique idea instead of repeated legacy prompt scaffolding", () => {
    expect(
      displayConceptDescription(
        "3D-концепт по запросу «ваза с узором»: биоморфная форма с плавными органическими линиями; творческое направление 4.1, единый цельный объект, пригодный для 3D-печати",
      ),
    ).toBe("Биоморфная форма с плавными органическими линиями");
    expect(
      displayConceptDescription(
        "Ваза с узором: северные руны в спиральном ритме. Цельная форма, пригодная для 3D-печати.",
      ),
    ).toBe("Ваза с узором: северные руны в спиральном ритме.");
  });
});
