import { describe, expect, it } from "vitest";
import { compatCheck, type CompatFilamentInput, type CompatPrinterInput } from "./compatibility.ts";

// Golden-кейсы MF-409 (Фаза 2 эпика MF-33, «Готово когда» п.2): версионируемый набор правил —
// регрессия любого из этих вердиктов должна валить CI. Каждый кейс из формулировки эпика
// покрыт минимум одним тестом ниже; доп. кейсы (диаметр/температура/сушка/аргументность)
// добавлены как тот же контракт, не отдельная фича. Значения needsChamber/needsDirectDrive/
// needsDrying/fillType — то, что реально лежит в material_types.requires_*/materials.specs.fill_type
// после Фазы 1 (MF-408), не собственная эвристика теста.

const OPEN_BRASS_PRINTER: CompatPrinterInput = {
  buildVolumeMm: { x: 220, y: 220, z: 250 },
  nozzleHardened: false,
  maxHotendTempC: 260,
  chamber: "none",
  extruderDrive: "bowden",
  filamentDiameterMm: 1.75,
};

const ENCLOSED_HARDENED_DIRECT_PRINTER: CompatPrinterInput = {
  buildVolumeMm: { x: 256, y: 256, z: 256 },
  nozzleHardened: true,
  maxHotendTempC: 300,
  chamber: "active",
  extruderDrive: "direct",
  filamentDiameterMm: 1.75,
};

const PETG_CF: CompatFilamentInput = {
  materialFamily: "petg",
  fillType: "carbon",
  needsChamber: false,
  extruderTempMaxC: 260,
  diameterMm: 1.75,
};

const ABS: CompatFilamentInput = {
  materialFamily: "abs",
  needsChamber: true,
  extruderTempMaxC: 250,
  diameterMm: 1.75,
};

const TPU: CompatFilamentInput = {
  materialFamily: "tpu",
  needsDirectDrive: true,
  extruderTempMaxC: 230,
  diameterMm: 1.75,
};

const PLA: CompatFilamentInput = {
  materialFamily: "pla",
  extruderTempMaxC: 220,
  diameterMm: 1.75,
};

const PA: CompatFilamentInput = {
  materialFamily: "pa",
  needsDrying: true,
  extruderTempMaxC: 280,
  diameterMm: 1.75,
};

describe("compatCheck golden cases (MF-33/MF-409)", () => {
  it("PETG-CF на латунном сопле → blocked «нужно закалённое сопло»", () => {
    const result = compatCheck(OPEN_BRASS_PRINTER, PETG_CF);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.map((r) => r.code)).toContain("abrasive_requires_hardened_nozzle");
    expect(result.reasons.find((r) => r.code === "abrasive_requires_hardened_nozzle")?.message).toMatch(/закал/);
  });

  it("ABS на открытом принтере (без камеры) → warn «варпинг без камеры»", () => {
    const result = compatCheck(OPEN_BRASS_PRINTER, ABS);
    expect(result.verdict).toBe("warn");
    expect(result.reasons.map((r) => r.code)).toContain("chamber_recommended");
  });

  it("модель 300мм на столе 256мм → blocked «не влезет»", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, buildVolumeMm: { x: 256, y: 256, z: 256 } };
    const result = compatCheck(printer, undefined, { bboxMm: { x: 300, y: 200, z: 150 } });
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.map((r) => r.code)).toContain("geometry_exceeds_build_volume");
  });

  it("TPU на боудене → warn (желателен директ-драйв)", () => {
    const result = compatCheck(OPEN_BRASS_PRINTER, TPU);
    expect(result.verdict).toBe("warn");
    expect(result.reasons.map((r) => r.code)).toContain("direct_drive_recommended");
  });

  it("совместимая связка (PLA, закрытый закалённый директ-драйв станок, модель влезает) → ok", () => {
    const result = compatCheck(ENCLOSED_HARDENED_DIRECT_PRINTER, PLA, { bboxMm: { x: 100, y: 100, z: 100 } });
    expect(result.verdict).toBe("ok");
    expect(result.reasons).toEqual([]);
  });
});

describe("compatCheck arity (1/2/3 аргумента)", () => {
  it("вызывается только с принтером → ok, причин нет (нечего проверять)", () => {
    const result = compatCheck(OPEN_BRASS_PRINTER);
    expect(result.verdict).toBe("ok");
    expect(result.reasons).toEqual([]);
  });

  it("вызывается с принтером и филаментом (без модели) → пропускает геометрию", () => {
    const result = compatCheck(ENCLOSED_HARDENED_DIRECT_PRINTER, PLA);
    expect(result.verdict).toBe("ok");
    expect(result.reasons.some((r) => r.code === "geometry_exceeds_build_volume")).toBe(false);
  });

  it("вызывается с принтером и моделью (без филамента) → только геометрия", () => {
    const fits = compatCheck(ENCLOSED_HARDENED_DIRECT_PRINTER, undefined, { bboxMm: { x: 100, y: 100, z: 100 } });
    expect(fits.verdict).toBe("ok");

    const tooBig = compatCheck(ENCLOSED_HARDENED_DIRECT_PRINTER, undefined, { bboxMm: { x: 400, y: 100, z: 100 } });
    expect(tooBig.verdict).toBe("blocked");
  });
});

describe("compatCheck geometry: допустимо разворачивать модель по Z (свап X/Y)", () => {
  it("модель 200×100 влезает в стол 100×200 после разворота", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, buildVolumeMm: { x: 100, y: 200, z: 100 } };
    const result = compatCheck(printer, undefined, { bboxMm: { x: 190, y: 90, z: 90 } });
    expect(result.verdict).toBe("ok");
  });

  it("отступ под avoidance-зоны учитывается — впритык без запаса всё равно blocked", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, buildVolumeMm: { x: 100, y: 100, z: 100 } };
    const result = compatCheck(printer, undefined, { bboxMm: { x: 99, y: 99, z: 99 } });
    expect(result.verdict).toBe("blocked");
  });
});

describe("compatCheck hardware-gate: температура, сушка и диаметр", () => {
  it("температура печати выше максимума хотэнда → blocked", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, maxHotendTempC: 260 };
    const result = compatCheck(printer, PA);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.map((r) => r.code)).toContain("hotend_max_temp_exceeded");
  });

  it("гигроскопичный материал (PA) → warn «нужна сушка», независимо от станка", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, maxHotendTempC: 300 };
    const result = compatCheck(printer, PA);
    expect(result.verdict).toBe("warn");
    expect(result.reasons.map((r) => r.code)).toContain("drying_recommended");
  });

  it("диаметр филамента не совпадает со станком → blocked", () => {
    const filament: CompatFilamentInput = { materialFamily: "pla", diameterMm: 2.85 };
    const result = compatCheck(ENCLOSED_HARDENED_DIRECT_PRINTER, filament);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.map((r) => r.code)).toContain("filament_diameter_mismatch");
  });

  it("абразивный материал без данных о сопле (nozzleHardened не задан) → warn, не blocked", () => {
    const printer: CompatPrinterInput = { ...ENCLOSED_HARDENED_DIRECT_PRINTER, nozzleHardened: undefined };
    const result = compatCheck(printer, PETG_CF);
    expect(result.verdict).toBe("warn");
    expect(result.reasons.map((r) => r.code)).toContain("abrasive_nozzle_unknown");
  });

  it("needsChamber=false у ABS (явный override продукта) снимает предупреждение про камеру", () => {
    const filament: CompatFilamentInput = { ...ABS, needsChamber: false };
    const result = compatCheck(OPEN_BRASS_PRINTER, filament);
    expect(result.reasons.some((r) => r.code === "chamber_recommended")).toBe(false);
  });

  it("камера passive тоже снимает предупреждение (не только active)", () => {
    const printer: CompatPrinterInput = { ...OPEN_BRASS_PRINTER, chamber: "passive" };
    const result = compatCheck(printer, ABS);
    expect(result.reasons.some((r) => r.code === "chamber_recommended")).toBe(false);
  });
});

describe("compatCheck verdict priority: blocked перевешивает warn", () => {
  it("одновременно abrasive-blocked и chamber-warn → verdict blocked", () => {
    const result = compatCheck(OPEN_BRASS_PRINTER, { ...PETG_CF, materialFamily: "abs", needsChamber: true });
    expect(result.verdict).toBe("blocked");
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toContain("abrasive_requires_hardened_nozzle");
    expect(codes).toContain("chamber_recommended");
  });
});
