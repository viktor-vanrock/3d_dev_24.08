import { describe, expect, it } from "vitest";
import type { FirmwarePilotStage, FirmwarePilotStatus } from "@portal/contracts/http/devices";
import { pilotInfoFor } from "./firmwarepilot.ts";

const UPDATED_AT = "2026-07-15T01:00:00Z";
const LOCAL_DATE = new Date(UPDATED_AT).toLocaleString("ru-RU");

function reported(stage: FirmwarePilotStage, freshness: "fresh" | "stale" = "fresh"): FirmwarePilotStatus {
  return {
    status: "reported",
    stage,
    updated_at: UPDATED_AT,
    freshness,
    source: "fleet",
    confidence: stage === "ready" ? "verified" : "limited",
  } as FirmwarePilotStatus;
}

// park.md §3.2 — сырой enum `status.stage` не должен утечь в UI, только словарь.
describe("pilotInfoFor — словарь park.md §3.2/§3.3 (MF-1868)", () => {
  it.each([
    ["not_started", "не начат", "не начат"],
    ["building", "сборка", "сборка"],
    ["burn_in", "обкатка", "обкатка"],
    ["ready", "готово", "готово, подтверждено"],
  ] as const)("свежий факт stage=%s → текст §3.2, tone=dim", (stage, labelText, ariaStage) => {
    const info = pilotInfoFor(reported(stage), "Ender-3 V3 KE");

    expect(info.label).toBe(`Пилот прошивки: ${labelText}`);
    expect(info.tone).toBe("dim");
    expect(info.secondLine).toBeNull();
    expect(info.ariaLabel).toBe(`Пилот прошивки Ender-3 V3 KE: ${ariaStage}, данные обновлены ${LOCAL_DATE}`);
  });

  it('stage="stopped" — отдельная ветка: «остановлено», tone=warn', () => {
    const info = pilotInfoFor(reported("stopped"), "FLSun V400");

    expect(info.label).toBe("Пилот прошивки: остановлено");
    expect(info.tone).toBe("warn");
    expect(info.secondLine).toBeNull();
    expect(info.ariaLabel).toBe(`Пилот прошивки FLSun V400: остановлено, данные обновлены ${LOCAL_DATE}`);
  });

  it("freshness=stale — tone=warn и вторая строка «Последний факт», независимо от stage", () => {
    const info = pilotInfoFor(reported("burn_in", "stale"), "Ender-3 V3 KE");

    expect(info.label).toBe("Пилот прошивки: данные устарели");
    expect(info.tone).toBe("warn");
    expect(info.secondLine).toBe(`Последний факт: обкатка, обновлено ${LOCAL_DATE}`);
    expect(info.ariaLabel).toBe(
      `Пилот прошивки Ender-3 V3 KE: данные устарели. Последний факт — обкатка, обновлён ${LOCAL_DATE}`,
    );
  });

  it("stale остановленного пилота называет последним фактом «остановлено», не текущей стадией", () => {
    const info = pilotInfoFor(reported("stopped", "stale"), "FLSun V400");

    expect(info.secondLine).toBe(`Последний факт: остановлено, обновлено ${LOCAL_DATE}`);
  });

  it.each([
    ["no_data", { status: "no_data" } as FirmwarePilotStatus],
    ["undefined", undefined],
  ])("%s → «нет данных о пилоте», tone=dim, visible=false", (_case, status) => {
    const info = pilotInfoFor(status, "Ender-3 V3 KE");

    expect(info.label).toBe("Пилот прошивки: нет данных о пилоте");
    expect(info.tone).toBe("dim");
    expect(info.visible).toBe(false);
    expect(info.ariaLabel).toBe("Пилот прошивки Ender-3 V3 KE: нет данных о пилоте");
  });

  it("KE и V400 не звучат одинаково для скринридера", () => {
    const status = reported("not_started");
    expect(pilotInfoFor(status, "Ender-3 V3 KE").ariaLabel).not.toBe(pilotInfoFor(status, "FLSun V400").ariaLabel);
  });

  it("stage=\"ready\" с confidence!==\"verified\" — невалидная комбинация по контракту, трактуется как «нет данных» (MF-1869)", () => {
    // Тип FirmwarePilotStatus исключает эту комбинацию на входе, но реальный payload идёт через
    // API без runtime-валидации на этом пути — форсируем через `as`, как producer мог бы прислать.
    const status = { ...reported("ready"), confidence: "limited" } as FirmwarePilotStatus;
    const info = pilotInfoFor(status, "FLSun V400");

    expect(info.visible).toBe(false);
    expect(info.label).toBe("Пилот прошивки: нет данных о пилоте");
  });
});
