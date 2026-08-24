// Plausibility-проверка перед merge (MF-406 п.4, декомпозиция MF-648): вменяемость
// объёма/термо/класса станка. Только МЯГКИЕ верхние/нижние границы того, что физически
// встречается у настольных FDM/SLA принтеров — не полная валидация схемы (специфика
// конкретных полей вида остаётся на совести адаптера-источника, см. ./normalize.ts).
// Отсутствующее поле не проверяется (адаптер мог его просто не найти) — implausible
// значит "поле есть, но абсурдно", не "поля нет".
//
// build_volume-границы (0 < x,y,z ≤ 2000мм) — тот же диапазон, что уже принят в
// scripts/import-machines-bootstrap.ts (проверено вручную на bootstrap-датасете 337
// станков). Термо-границы (0 < nozzle ≤ 500°C, 0 < bed ≤ 200°C) — консервативный потолок
// под самые горячие прод-хотэнды/камеры (высокотемпературные ABS/PA/PEEK-принтеры), не
// подтверждён датасетом так же строго — если окажется тесно, двигаем одной правкой here.
const MAX_BUILD_DIM_MM = 2000;
const MAX_NOZZLE_TEMP_C = 500;
const MAX_BED_TEMP_C = 200;

interface BuildVolume {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  [key: string]: unknown;
}

export interface CandidateSpecs {
  build_volume?: BuildVolume;
  max_nozzle_temp_c?: unknown;
  max_bed_temp_c?: unknown;
  kinematics?: unknown;
  [key: string]: unknown;
}

export interface PlausibilityResult {
  plausible: boolean;
  reasons: string[];
}

function isFiniteInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > min && value <= max;
}

export function checkPlausibility(specs: CandidateSpecs): PlausibilityResult {
  const reasons: string[] = [];

  const bv = specs.build_volume;
  if (bv && (bv.x !== undefined || bv.y !== undefined || bv.z !== undefined)) {
    for (const [axis, value] of [
      ["x", bv.x],
      ["y", bv.y],
      ["z", bv.z],
    ] as const) {
      if (!isFiniteInRange(value, 0, MAX_BUILD_DIM_MM)) {
        reasons.push(`build_volume.${axis} вне диапазона (0, ${MAX_BUILD_DIM_MM}]мм: ${JSON.stringify(value)}`);
      }
    }
  }

  if (specs.max_nozzle_temp_c !== undefined && !isFiniteInRange(specs.max_nozzle_temp_c, 0, MAX_NOZZLE_TEMP_C)) {
    reasons.push(`max_nozzle_temp_c вне диапазона (0, ${MAX_NOZZLE_TEMP_C}]°C: ${JSON.stringify(specs.max_nozzle_temp_c)}`);
  }

  if (specs.max_bed_temp_c !== undefined && !isFiniteInRange(specs.max_bed_temp_c, 0, MAX_BED_TEMP_C)) {
    reasons.push(`max_bed_temp_c вне диапазона (0, ${MAX_BED_TEMP_C}]°C: ${JSON.stringify(specs.max_bed_temp_c)}`);
  }

  if (specs.kinematics !== undefined && (typeof specs.kinematics !== "string" || specs.kinematics.trim().length === 0)) {
    reasons.push(`kinematics пустой/не строка: ${JSON.stringify(specs.kinematics)}`);
  }

  return { plausible: reasons.length === 0, reasons };
}
