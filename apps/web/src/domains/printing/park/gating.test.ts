import { describe, expect, it } from "vitest";
import { allManagedUnavailable, computeGating } from "./gating.ts";

// Гейтинг плиток уровня (MF-903, printer.wizard.md §3.3) — таблица примеров буквально из спеки.

describe("computeGating", () => {
  it("list всегда светится, даже без данных о модели", () => {
    const gating = computeGating(null);
    expect(gating.list.enabled).toBe(true);
  });

  it("managed-cloud в v1 всегда погашена «скоро», независимо от модели", () => {
    const gating = computeGating({ connectorType: "bambu-mqtt", firmwareReady: true });
    expect(gating["managed-cloud"].enabled).toBe(false);
    expect(gating["managed-cloud"].reasonKind).toBe("soon");
  });

  it("moonraker → managed-local и managed-bridge светятся", () => {
    const gating = computeGating({ connectorType: "moonraker" });
    expect(gating["managed-local"].enabled).toBe(true);
    expect(gating["managed-bridge"].enabled).toBe(true);
  });

  it("не каждый локальный API означает готовый bridge в v1", () => {
    const gating = computeGating({ connectorType: "prusa-link" });
    expect(gating["managed-local"].enabled).toBe(true);
    expect(gating["managed-bridge"].enabled).toBe(false);
    expect(gating["managed-bridge"].reasonKind).toBe("model");
  });

  it("connector_type=none (Marlin) → managed-local/bridge погашены «недоступно этой модели»", () => {
    const gating = computeGating({ connectorType: "none" });
    expect(gating["managed-local"].enabled).toBe(false);
    expect(gating["managed-local"].reasonKind).toBe("model");
    expect(gating["managed-bridge"].enabled).toBe(false);
  });

  it("не классифицировано (null/отсутствует поле) → тоже честно погашено, не выдумываем", () => {
    const gating = computeGating(null);
    expect(gating["managed-local"].enabled).toBe(false);
    expect(gating["managed-local"].reasonKind).toBe("model");
  });

  it("custom светится только при firmware_ready=true", () => {
    expect(computeGating({ connectorType: "moonraker", firmwareReady: true }).custom.enabled).toBe(true);
    expect(computeGating({ connectorType: "moonraker", firmwareReady: false }).custom.enabled).toBe(false);
    expect(computeGating({ connectorType: "moonraker", firmwareReady: false }).custom.reasonKind).toBe("soon");
  });

  it("Marlin получает модельную причину и для custom, а не roadmap-сообщение", () => {
    const gate = computeGating({ connectorType: "none", firmwareReady: false }).custom;
    expect(gate.reasonKind).toBe("model");
    expect(gate.reason).toContain("Недоступно этой модели");
  });

  it("allManagedUnavailable — true, когда managed-*/custom все погашены (Marlin, firmware не готова)", () => {
    const gating = computeGating({ connectorType: "none", firmwareReady: false });
    expect(allManagedUnavailable(gating)).toBe(true);
  });

  it("allManagedUnavailable — false, если хотя бы один уровень светится", () => {
    const gating = computeGating({ connectorType: "moonraker" });
    expect(allManagedUnavailable(gating)).toBe(false);
  });
});
