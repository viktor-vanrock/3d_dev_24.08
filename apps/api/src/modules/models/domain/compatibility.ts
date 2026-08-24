// compat.check (MF-409, Фаза 2 эпика MF-33 «Движок совместимости принтер×филамент×модель»).
// Чистая детерминированная функция над уже прочитанными характеристиками станка/материала/
// модели — сама по БД не ходит (маппинг из machines.specs/material_types/materials.specs/
// models.bbox в контракт ниже — задача потребителя, см. TSDoc у каждого поля). Причины
// человекочитаемые на русском, формулировки best-effort («скорее всего»), не гарантия —
// реальный слайсинг не делаем (docs/epics/domain.model.md § риски эпика MF-33).
//
// Контракт входа — ПРЯМОЕ отражение уже задокументированного контракта Фазы 1 (MF-408,
// docs/epics/domain.model.md § «Движок совместимости — фундамент данных (MF-33 Фаза 1 /
// MF-408)», п.2-3): канонические ключи `machines.specs` (`nozzle_hardened`,
// `max_hotend_temp_c`, `chamber`, `chamber_max_temp_c`, `filament_dia_mm`) и колонки
// `material_types` (`requires_chamber`/`requires_drying`/`requires_direct_drive`,
// `default_extruder_temp_c`/`default_bed_temp_c`) + `materials.specs.fill_type` (MF-402).
// Эта функция НЕ содержит собственных family-эвристик («ABS значит камера») — те уже решены
// на уровне данных Фазой 1 (`material_types.requires_*`, best-effort backfill по семейству);
// здесь только чтение уже разрешённых потребителем флагов. Единственное расширение контракта
// этой фазой — `machines.specs.extruder_drive` (`'direct'|'bowden'`), которого не было в
// списке Фазы 1 (нужен правилу TPU→директ-драйв), см. domain.model.md § «Движок совместимости
// (MF-33 compat.check)».

export type ChamberType = "none" | "passive" | "active";
export type ExtruderDrive = "direct" | "bowden";
/** materials.specs.fill_type (MF-402); только carbon/glass делают филамент абразивным для сопла. */
export type FillType = "carbon" | "glass" | "wood" | "metal" | "glitter" | "ceramic";

const ABRASIVE_FILL_TYPES: ReadonlySet<FillType> = new Set(["carbon", "glass"]);

/** machines.specs, подмножество, читаемое compat.check (см. header-комментарий). */
export interface CompatPrinterInput {
  /** Рабочий объём станка, мм. */
  buildVolumeMm: { x: number; y: number; z: number };
  /** machines.specs.nozzle_hardened — закалённая сталь/рубин (может абразив). undefined — неизвестно. */
  nozzleHardened?: boolean;
  /** machines.specs.max_hotend_temp_c. */
  maxHotendTempC?: number;
  /** machines.specs.chamber. */
  chamber?: ChamberType;
  /** machines.specs.extruder_drive — расширение контракта этой фазой, см. header-комментарий. */
  extruderDrive?: ExtruderDrive;
  /** machines.specs.filament_dia_mm — ожидаемый станком диаметр прутка, мм (1.75/2.85/3.0). */
  filamentDiameterMm?: number;
}

/**
 * material_types + materials.specs, подмножество, читаемое compat.check. needsChamber/
 * needsDirectDrive/needsDrying — уже разрешённые потребителем значения
 * material_types.requires_chamber/requires_direct_drive/requires_drying (семейные, MF-408 п.3),
 * НЕ вычисляются здесь по materialFamily. extruderTempMaxC — material_types.default_extruder_temp_c
 * (или override из materials.specs, если продукт отличается от дефолта семейства).
 */
export interface CompatFilamentInput {
  /** material_types.slug (pla/petg/abs/asa/tpu/pa/pc/…) — только для сообщений/логов, не для правил. */
  materialFamily: string;
  fillType?: FillType;
  needsChamber?: boolean;
  needsDirectDrive?: boolean;
  needsDrying?: boolean;
  extruderTempMaxC?: number;
  diameterMm?: number;
}

/** models.bbox / model_meshes.bbox — уже извлечённый на этапе загрузки/конвертации (MF-22). */
export interface CompatModelInput {
  bboxMm: { x: number; y: number; z: number };
}

export type CompatVerdict = "ok" | "warn" | "blocked";

export interface CompatReason {
  code: string;
  severity: "warn" | "blocked";
  message: string;
}

export interface CompatResult {
  verdict: CompatVerdict;
  reasons: CompatReason[];
}

// Консервативный отступ под avoidance-зоны тулхеда (домен.model.md § риски эпика: «в v1 берём
// консервативный отступ», без данных по зонам конкретного станка). Единое число, а не per-axis —
// v1 не различает станки, при появлении реальных avoidance-профилей это первый кандидат на замену.
// Экспортирован — GET /models?compatibility=mine (models/list.ts) переиспользует то же число
// для геометрического предфильтра в SQL, не задваивает магическую константу.
export const DEFAULT_MARGIN_MM = 5;
// Допуск на диаметр прутка (номинал 1.75/2.85/3.0 у разных источников округляется по-разному).
const DIAMETER_TOLERANCE_MM = 0.05;

function isAbrasive(filament: CompatFilamentInput): boolean {
  return filament.fillType !== undefined && ABRASIVE_FILL_TYPES.has(filament.fillType);
}

// Модель на столе можно развернуть по Z (вертикальная ось тулхеда фиксирована, но плита —
// нет): пробуем и как есть, и со свапом X/Y, с накинутым по каждой оси отступом. Экспортирован
// для того же переиспользования, что и DEFAULT_MARGIN_MM выше (models/list.ts::evaluateFleetMatch).
export function fitsBuildVolume(bbox: { x: number; y: number; z: number }, build: { x: number; y: number; z: number }, marginMm: number): boolean {
  const fits = (x: number, y: number, z: number) => x + marginMm <= build.x && y + marginMm <= build.y && z + marginMm <= build.z;
  return fits(bbox.x, bbox.y, bbox.z) || fits(bbox.y, bbox.x, bbox.z);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * compat.check(printer, filament?, model?) → {verdict, reasons}. Вызывается с 1 (только
 * геометрия/железо неприменимы — просто ok), 2 (принтер+филамент — hardware-gate) или 3
 * (принтер+филамент+модель — плюс геометрия) аргументами. verdict = 'blocked', если есть хотя
 * бы одна причина уровня blocked; иначе 'warn', если есть хотя бы одна warn; иначе 'ok'.
 */
export function compatCheck(printer: CompatPrinterInput, filament?: CompatFilamentInput, model?: CompatModelInput): CompatResult {
  const reasons: CompatReason[] = [];

  if (model) {
    if (!fitsBuildVolume(model.bboxMm, printer.buildVolumeMm, DEFAULT_MARGIN_MM)) {
      const b = model.bboxMm;
      const v = printer.buildVolumeMm;
      reasons.push({
        code: "geometry_exceeds_build_volume",
        severity: "blocked",
        message:
          `Модель ${fmt(b.x)}×${fmt(b.y)}×${fmt(b.z)} мм не влезает в рабочий объём станка ` +
          `${fmt(v.x)}×${fmt(v.y)}×${fmt(v.z)} мм даже с учётом отступа ${DEFAULT_MARGIN_MM} мм — не влезет.`,
      });
    }
  }

  if (filament) {
    if (isAbrasive(filament)) {
      if (printer.nozzleHardened === undefined) {
        reasons.push({
          code: "abrasive_nozzle_unknown",
          severity: "warn",
          message:
            "Материал абразивный (наполнитель CF/GF) — не удалось определить, стоит ли на станке " +
            "закалённое сопло. Уточните перед печатью: латунное сопло, скорее всего, быстро сотрётся.",
        });
      } else if (!printer.nozzleHardened) {
        reasons.push({
          code: "abrasive_requires_hardened_nozzle",
          severity: "blocked",
          message: "Материал абразивный (наполнитель CF/GF) — нужно закалённое сопло, латунное быстро сотрётся.",
        });
      }
    }

    if (filament.needsChamber && (printer.chamber === undefined || printer.chamber === "none")) {
      reasons.push({
        code: "chamber_recommended",
        severity: "warn",
        message: "Материал склонен к варпингу/расслоению без закрытой камеры — на открытом станке скорее всего поведёт.",
      });
    }

    if (filament.needsDirectDrive && printer.extruderDrive === "bowden") {
      reasons.push({
        code: "direct_drive_recommended",
        severity: "warn",
        message: "Гибкий материал на боуден-экструдере скорее всего будет проскальзывать/мяться — желателен директ-драйв.",
      });
    }

    if (filament.needsDrying) {
      reasons.push({
        code: "drying_recommended",
        severity: "warn",
        message: "Материал гигроскопичен — просушите перед печатью, иначе вероятны пузыри и слабый шов между слоями.",
      });
    }

    if (filament.extruderTempMaxC !== undefined && printer.maxHotendTempC !== undefined) {
      if (filament.extruderTempMaxC > printer.maxHotendTempC) {
        reasons.push({
          code: "hotend_max_temp_exceeded",
          severity: "blocked",
          message: `Материалу нужно до ${fmt(filament.extruderTempMaxC)}°C, хотэнд станка держит максимум ` + `${fmt(printer.maxHotendTempC)}°C — не прогреет.`,
        });
      }
    }

    if (filament.diameterMm !== undefined && printer.filamentDiameterMm !== undefined) {
      if (Math.abs(filament.diameterMm - printer.filamentDiameterMm) > DIAMETER_TOLERANCE_MM) {
        reasons.push({
          code: "filament_diameter_mismatch",
          severity: "blocked",
          message: `Диаметр прутка ${fmt(filament.diameterMm)} мм не совпадает с ожидаемым станком ` + `${fmt(printer.filamentDiameterMm)} мм.`,
        });
      }
    }
  }

  const verdict: CompatVerdict = reasons.some((r) => r.severity === "blocked") ? "blocked" : reasons.some((r) => r.severity === "warn") ? "warn" : "ok";

  return { verdict, reasons };
}
