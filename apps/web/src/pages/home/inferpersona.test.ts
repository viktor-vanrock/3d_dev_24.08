import { describe, expect, it } from "vitest";
import type { Activation, UserPrinter } from "@shared/lib";
import { inferPersona, shouldApplyInferredPersona } from "./inferpersona.ts";

function baseActivation(overrides: Partial<Activation> = {}): Activation {
  return {
    state: "returning",
    has_printer: false,
    primary_persona: null,
    persona_source: null,
    home_tier: "auto",
    activation_checklist: {},
    home_dismissed_prompts: {},
    ...overrides,
  };
}

function printers(count: number): UserPrinter[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    brand: "Bambu Lab",
    model: `A1 mini #${i}`,
    is_primary: i === 0,
    verified: true,
  }));
}

describe("inferPersona", () => {
  it("null — нет ни одного сигнала", () => {
    expect(inferPersona(baseActivation(), printers(0))).toBeNull();
  });

  it("pro — 3+ принтера в парке (сильнейший сигнал масштаба)", () => {
    expect(inferPersona(baseActivation({ has_printer: true }), printers(3))).toBe("pro");
  });

  it("author — загрузил первую модель", () => {
    const activation = baseActivation({ activation_checklist: { model_uploaded: true } });
    expect(inferPersona(activation, printers(0))).toBe("author");
  });

  it("maker — есть принтер и уже листал каталог", () => {
    const activation = baseActivation({ has_printer: true, activation_checklist: { catalog_visited: true } });
    expect(inferPersona(activation, printers(1))).toBe("maker");
  });

  it("приоритет: 3+ принтера побеждает даже если модель тоже загружена", () => {
    const activation = baseActivation({ has_printer: true, activation_checklist: { model_uploaded: true } });
    expect(inferPersona(activation, printers(3))).toBe("pro");
  });
});

describe("shouldApplyInferredPersona", () => {
  it("true — персона пуста (пропустил/просто посмотреть)", () => {
    expect(shouldApplyInferredPersona(baseActivation())).toBe(true);
  });

  it("true — персона уже inferred (можно уточнять дальше)", () => {
    expect(shouldApplyInferredPersona(baseActivation({ primary_persona: "maker", persona_source: "inferred" }))).toBe(true);
  });

  it("false — персона declared, инференс её не трогает", () => {
    expect(shouldApplyInferredPersona(baseActivation({ primary_persona: "author", persona_source: "declared" }))).toBe(false);
  });
});
