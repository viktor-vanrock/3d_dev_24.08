import type { BaselineProfile, ChangedField, FilamentInput, PrinterInput, ProfileIntent, Recommendation } from "./slicer-profile.ts";

const INTENT_NAMES: Record<ProfileIntent, string> = {
  strength: "прочность",
  speed: "скорость",
  appearance: "вид",
  miniatures: "миниатюры",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function merge(base: Record<string, unknown>, delta: Record<string, unknown>): Record<string, unknown> {
  const result = clone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(delta)) {
    if (isRecord(result[key]) && isRecord(value)) result[key] = merge(result[key], value);
    else result[key] = clone(value);
  }
  return result;
}

function numberAt(value: unknown, path: readonly string[]): number | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function distance(actual: number | null, expected: number | null, scale = 1): number {
  if (actual === null || expected === null) return 0;
  return Math.abs(actual - expected) / scale;
}

function profileKeyDistance(profile: BaselineProfile, printer: PrinterInput): number {
  const params = profile.params;
  let score = profile.machineId === printer.id ? 0 : profile.machineId === null ? 0.5 : 25;
  const kinematics = typeof params.kinematics === "string" ? params.kinematics.toLowerCase() : null;
  if (kinematics !== null && printer.kinematics !== null && kinematics !== printer.kinematics.toLowerCase()) score += 10;
  score += distance(numberAt(params, ["nozzle_diameter_mm"]), printer.nozzleDiameterMm, 0.1);
  for (const axis of ["x", "y", "z"] as const) {
    score += distance(numberAt(params, ["build_volume_mm", axis]), printer.buildVolumeMm[axis], 100);
  }
  score += distance(numberAt(params, ["max_nozzle_temp_c"]), printer.maxNozzleTempC, 50);
  score += distance(numberAt(params, ["max_bed_temp_c"]), printer.maxBedTempC, 30);
  return score;
}

function selectBase(profiles: readonly BaselineProfile[], printer: PrinterInput): BaselineProfile | null {
  const candidates = profiles.filter(({ profileClass }) => profileClass === "process" || profileClass === "machine");
  candidates.sort((left, right) => {
    const classDiff = Number(left.profileClass !== "process") - Number(right.profileClass !== "process");
    return classDiff || profileKeyDistance(left, printer) - profileKeyDistance(right, printer) || left.id.localeCompare(right.id);
  });
  return candidates[0] ?? null;
}

function isExactBase(profile: BaselineProfile, printer: PrinterInput): boolean {
  return profile.extrapolatedFromId === null && (profile.machineId === null || profile.machineId === printer.id) && profileKeyDistance(profile, printer) === 0;
}

function selectOverlay(profiles: readonly BaselineProfile[], filament: FilamentInput, nozzleDiameterMm: number | null): BaselineProfile | null {
  const candidates = profiles.filter(({ profileClass, materialId, params }) => {
    if (profileClass !== "filament") return false;
    if (materialId === filament.id) return true;
    const materialClass = params.material_class ?? params.material_type ?? params.material_family;
    return typeof materialClass === "string" && materialClass.toLowerCase() === filament.materialClass.toLowerCase();
  });
  candidates.sort((left, right) => {
    const exactDiff = Number(left.materialId !== filament.id) - Number(right.materialId !== filament.id);
    const nozzleDiff =
      distance(numberAt(left.params, ["nozzle_diameter_mm"]), nozzleDiameterMm, 0.1) - distance(numberAt(right.params, ["nozzle_diameter_mm"]), nozzleDiameterMm, 0.1);
    return exactDiff || nozzleDiff || left.id.localeCompare(right.id);
  });
  return candidates[0] ?? null;
}

function addChanged(changed: ChangedField[], field: string, value: unknown, reason: string): void {
  const existing = changed.find((item) => item.field === field);
  if (existing === undefined) changed.push({ field, value: clone(value), reason });
  else {
    existing.value = value;
    existing.reason = `${existing.reason}; ${reason}`;
  }
}

function applyIntent(params: Record<string, unknown>, intent: ProfileIntent, changed: ChangedField[]): Record<string, unknown> {
  const configured = isRecord(params.intent_overrides) && isRecord(params.intent_overrides[intent]) ? params.intent_overrides[intent] : {};
  const withoutOverrides = Object.fromEntries(Object.entries(params).filter(([key]) => key !== "intent_overrides"));
  const result = merge(withoutOverrides, configured);
  for (const key of Object.keys(result)) {
    if (JSON.stringify(withoutOverrides[key]) !== JSON.stringify(result[key])) {
      addChanged(changed, key, result[key], `настройка intent «${INTENT_NAMES[intent]}»`);
    }
  }
  return result;
}

function clampValue(params: Record<string, unknown>, changed: ChangedField[], key: string, max: number | null): void {
  if (max === null) return;
  const value = params[key];
  const reason = "ограничено паспортом принтера для безопасности";
  if (typeof value === "number" && value > max) {
    params[key] = max;
    addChanged(changed, key, max, reason);
  } else if (isRecord(value)) {
    const next = clone(value) as Record<string, unknown>;
    let didClamp = false;
    for (const [nestedKey, nestedValue] of Object.entries(next)) {
      if (typeof nestedValue === "number" && nestedValue > max) {
        next[nestedKey] = max;
        didClamp = true;
      }
    }
    if (didClamp) {
      params[key] = next;
      addChanged(changed, key, next, reason);
    }
  }
}

function clampToPassport(params: Record<string, unknown>, printer: PrinterInput, changed: ChangedField[]): void {
  for (const key of ["nozzle_temperature_c", "nozzle_temp_c"]) clampValue(params, changed, key, printer.maxNozzleTempC);
  for (const key of ["bed_temperature_c", "bed_temp_c"]) clampValue(params, changed, key, printer.maxBedTempC);
  if (printer.maxPrintSpeedMmS === null) return;
  for (const key of Object.keys(params)) {
    if (["print_speed_mm_s", "first_layer_speed_mm_s", "travel_speed_mm_s"].includes(key) || key.endsWith("wall_speed_mm_s")) {
      clampValue(params, changed, key, printer.maxPrintSpeedMmS);
    }
  }
}

function resolveInheritance(profile: BaselineProfile, profiles: readonly BaselineProfile[]): Record<string, unknown> {
  const byId = new Map(profiles.map((item) => [item.id, item]));
  const chain: BaselineProfile[] = [];
  const seen = new Set<string>();
  let current: BaselineProfile | undefined = profile;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.inheritsId === null ? undefined : byId.get(current.inheritsId);
  }
  return chain.reduce<Record<string, unknown>>((result, item) => merge(result, item.params), {});
}

export function recommendProfile(printer: PrinterInput, filament: FilamentInput, profiles: readonly BaselineProfile[], intent: ProfileIntent): Recommendation | null {
  const base = selectBase(profiles, printer);
  if (base === null) return null;
  let params = resolveInheritance(base, profiles);
  const changed: ChangedField[] = [];
  const overlay = selectOverlay(profiles, filament, printer.nozzleDiameterMm);
  if (overlay !== null) {
    const before = params;
    params = merge(params, overlay.params);
    for (const key of Object.keys(params)) {
      if (key !== "intent_overrides" && JSON.stringify(before[key]) !== JSON.stringify(params[key])) {
        addChanged(changed, key, params[key], `дельта материала класса «${filament.materialClass}»`);
      }
    }
  }
  params = applyIntent(params, intent, changed);
  clampToPassport(params, printer, changed);
  const extrapolated = !isExactBase(base, printer);
  const confidence = Math.round(Math.max(0, Math.min(1, base.confidence * (overlay?.confidence ?? 1) * (extrapolated ? 0.75 : 1))) * 100) / 100;
  return {
    params,
    confidence,
    extrapolated,
    disclaimer: extrapolated
      ? "Профиль экстраполирован из ближайшего базового класса; перед печатью проверьте температуры и скорости по паспорту принтера."
      : "Профиль подобран детерминированно и ограничен паспортом принтера; перед печатью проверьте фактические условия.",
    origin: {
      base_profile_id: base.id,
      base_profile_name: base.name,
      slicer: base.slicer,
      source_name: base.sourceName,
      source_url: base.sourceUrl,
      source_ref: base.sourceRef,
      license: base.license,
      overlay_profile_ids: overlay === null ? [] : [overlay.id],
      changed_fields: changed,
    },
  };
}
