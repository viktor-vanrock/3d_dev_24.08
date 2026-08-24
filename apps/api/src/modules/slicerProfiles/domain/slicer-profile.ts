export const PROFILE_CLASSES = ["machine", "process", "filament"] as const;
export type ProfileClass = (typeof PROFILE_CLASSES)[number];

export const PROFILE_INTENTS = ["strength", "speed", "appearance", "miniatures"] as const;
export type ProfileIntent = (typeof PROFILE_INTENTS)[number];

export const CALIBRATION_OUTCOMES = ["success", "defect"] as const;
export type CalibrationOutcome = (typeof CALIBRATION_OUTCOMES)[number];

export const CALIBRATION_DEFECT_TYPES = ["warping", "stringing", "layer_shift", "adhesion", "under_extrusion", "over_extrusion", "other"] as const;
export type CalibrationDefectType = (typeof CALIBRATION_DEFECT_TYPES)[number];

export const CALIBRATION_NOTES_MAX_LENGTH = 2000;
export const PROFILE_RECOMMENDATION_CONTRACT_VERSION = "slicer.profile-recommendation.v1" as const;

declare const slicerProfileIdBrand: unique symbol;
declare const machineIdBrand: unique symbol;
declare const materialIdBrand: unique symbol;

export type SlicerProfileId = string & { readonly [slicerProfileIdBrand]: true };
export type MachineId = string & { readonly [machineIdBrand]: true };
export type MaterialId = string & { readonly [materialIdBrand]: true };

export const SlicerProfileId = (value: string): SlicerProfileId => value as SlicerProfileId;
export const MachineId = (value: string): MachineId => value as MachineId;
export const MaterialId = (value: string): MaterialId => value as MaterialId;

export interface ListedProfile {
  readonly id: string;
  readonly name: string;
  readonly source_name: string;
  readonly machine_id: string | null;
  readonly material_id: string | null;
  readonly slicer: SlicerName;
}

export type SlicerName = "orcaslicer" | "prusaslicer" | "cura";

export interface PrinterInput {
  readonly id: string;
  readonly nozzleDiameterMm: number | null;
  readonly kinematics: string | null;
  readonly buildVolumeMm: { readonly x: number | null; readonly y: number | null; readonly z: number | null };
  readonly maxNozzleTempC: number | null;
  readonly maxBedTempC: number | null;
  readonly maxPrintSpeedMmS: number | null;
}

export interface FilamentInput {
  readonly id: string;
  readonly materialClass: string;
  readonly diameterMm: number | null;
}

export interface BaselineProfile {
  readonly id: string;
  readonly profileClass: ProfileClass;
  readonly slicer: SlicerName;
  readonly name: string;
  readonly machineId: string | null;
  readonly materialId: string | null;
  readonly inheritsId: string | null;
  readonly params: Record<string, unknown>;
  readonly sourceName: string;
  readonly sourceUrl: string | null;
  readonly sourceRef: string | null;
  readonly license: string;
  readonly confidence: number;
  readonly extrapolatedFromId: string | null;
}

export interface RecommendationInputs {
  readonly printer: PrinterInput;
  readonly filament: FilamentInput;
  readonly profiles: readonly BaselineProfile[];
}

export interface ChangedField {
  readonly field: string;
  value: unknown;
  reason: string;
}

export interface Recommendation {
  readonly params: Record<string, unknown>;
  readonly confidence: number;
  readonly extrapolated: boolean;
  readonly disclaimer: string;
  readonly origin: {
    readonly base_profile_id: string;
    readonly base_profile_name: string;
    readonly slicer: SlicerName;
    readonly source_name: string;
    readonly source_url: string | null;
    readonly source_ref: string | null;
    readonly license: string;
    readonly overlay_profile_ids: string[];
    readonly changed_fields: ChangedField[];
  };
}

export interface ProfileRecommendationResponse {
  readonly contract_version: typeof PROFILE_RECOMMENDATION_CONTRACT_VERSION;
  readonly printer_id: string;
  readonly filament_id: string;
  readonly intent: ProfileIntent;
  readonly profile: { readonly params: Record<string, unknown>; readonly confidence: number; readonly extrapolated: boolean };
  readonly explanation: Recommendation["origin"];
  readonly disclaimer: string;
}

export interface CalibrationInput {
  readonly machineId: MachineId;
  readonly materialId: MaterialId;
  readonly modelId: string | null;
  readonly makeId: string | null;
  readonly flowRatio: number | null;
  readonly pressureAdvance: number | null;
  readonly outcome: CalibrationOutcome;
  readonly defectType: CalibrationDefectType | null;
  readonly photoS3Key: string | null;
  readonly notes: string | null;
}

export interface CalibrationRow {
  readonly id: string;
  readonly slicer_profile_id: string;
  readonly machine_id: string;
  readonly material_id: string;
  readonly model_id: string | null;
  readonly make_id: string | null;
  readonly user_id: string;
  readonly flow_ratio: string | number | null;
  readonly pressure_advance: string | number | null;
  readonly outcome: CalibrationOutcome;
  readonly defect_type: CalibrationDefectType | null;
  readonly photo_s3_key: string | null;
  readonly notes: string | null;
  readonly source: "manual" | "telemetry";
  readonly created_at: Date | string;
}

export interface CalibrationResponse extends Omit<CalibrationRow, "flow_ratio" | "pressure_advance" | "created_at"> {
  readonly flow_ratio: number | null;
  readonly pressure_advance: number | null;
  readonly created_at: string;
}

export class SlicerProfileNotFoundError extends Error {}
export class MachineNotFoundError extends Error {}
export class MaterialNotFoundError extends Error {}
export class ModelNotFoundError extends Error {}
export class MakeNotFoundError extends Error {}

export function serializeRecommendation(printerId: string, filamentId: string, intent: ProfileIntent, recommendation: Recommendation): ProfileRecommendationResponse {
  return {
    contract_version: PROFILE_RECOMMENDATION_CONTRACT_VERSION,
    printer_id: printerId,
    filament_id: filamentId,
    intent,
    profile: {
      params: recommendation.params,
      confidence: recommendation.confidence,
      extrapolated: recommendation.extrapolated,
    },
    explanation: recommendation.origin,
    disclaimer: recommendation.disclaimer,
  };
}

export function serializeCalibration(row: CalibrationRow): CalibrationResponse {
  return {
    ...row,
    flow_ratio: row.flow_ratio === null ? null : Number(row.flow_ratio),
    pressure_advance: row.pressure_advance === null ? null : Number(row.pressure_advance),
    created_at: new Date(row.created_at).toISOString(),
  };
}
