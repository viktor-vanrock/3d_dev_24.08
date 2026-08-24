import { describe, expect, it } from "vitest";
import type { Activation } from "@shared/lib";
import { computeFirstRunStep } from "./firstrun.tsx";

// Состояние-машина first-run флоу (MF-437): чистая функция от персистентного activation,
// переживает reload — критерий приёмки «повторный промпт про принтер не на каждый вход»
// проверяется здесь, а не через рендер (дешевле и надёжнее полного стека фетчей).

function baseActivation(overrides: Partial<Activation> = {}): Activation {
  return {
    state: "first_run",
    has_printer: false,
    primary_persona: null,
    home_tier: "auto",
    activation_checklist: {},
    home_dismissed_prompts: {},
    ...overrides,
  };
}

describe("computeFirstRunStep", () => {
  it("persona — пока персона не выбрана", () => {
    expect(computeFirstRunStep(baseActivation())).toBe("persona");
  });

  it("printer_question — персона выбрана, вопрос про принтер ещё не задан", () => {
    expect(computeFirstRunStep(baseActivation({ primary_persona: "novice" }))).toBe("printer_question");
  });

  it("picker — ответили «Да», принтер ещё не привязан", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      home_dismissed_prompts: { printer_answer: "yes" },
    });
    expect(computeFirstRunStep(activation)).toBe("picker");
  });

  it("picker пропущен («Позже» внутри picker'а) → сразу filament, has_printer остаётся false", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      has_printer: false,
      home_dismissed_prompts: { printer_answer: "yes", picker: true },
    });
    expect(computeFirstRunStep(activation)).toBe("filament");
  });

  it("filament — принтер привязан, шаг филамента ещё не пройден", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      has_printer: true,
      home_dismissed_prompts: { printer_answer: "yes" },
    });
    expect(computeFirstRunStep(activation)).toBe("filament");
  });

  it("checklist — «да»-ветка полностью пройдена (принтер + филамент)", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      has_printer: true,
      home_dismissed_prompts: { printer_answer: "yes", filament: true },
    });
    expect(computeFirstRunStep(activation)).toBe("checklist");
  });

  it("soft_track — ответили «Пока нет»", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      home_dismissed_prompts: { printer_answer: "no" },
    });
    expect(computeFirstRunStep(activation)).toBe("soft_track");
  });

  it("soft_track — «Пропустить» ведёт туда же, что и «Пока нет»", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      home_dismissed_prompts: { printer_answer: "skip" },
    });
    expect(computeFirstRunStep(activation)).toBe("soft_track");
  });

  it("checklist — soft-track пройден (нет-ветка)", () => {
    const activation = baseActivation({
      primary_persona: "novice",
      home_dismissed_prompts: { printer_answer: "no", soft_track: true },
    });
    expect(computeFirstRunStep(activation)).toBe("checklist");
  });

  it("не переспрашивает printer_question повторно, даже если has_printer всё ещё false", () => {
    // Критерий приёмки MF-437: «повторный промпт про принтер не на каждый вход»
    // (гейт по home_dismissed_prompts) — once printer_answer зафиксирован, вопрос не возвращается.
    const activation = baseActivation({
      primary_persona: "novice",
      home_dismissed_prompts: { printer_answer: "skip", soft_track: true },
    });
    expect(computeFirstRunStep(activation)).not.toBe("printer_question");
  });
});
