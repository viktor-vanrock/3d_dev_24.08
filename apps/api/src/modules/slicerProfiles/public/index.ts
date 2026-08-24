import type { UserId } from "../../_kernel/brandedIds.ts";
import type {
  CalibrationInput,
  CalibrationResponse,
  ListedProfile,
  MachineId,
  MaterialId,
  ProfileClass,
  ProfileIntent,
  ProfileRecommendationResponse,
  SlicerProfileId,
  RecommendationInputs,
} from "../domain/slicer-profile.ts";

export { activeSlicerProfileName } from "../infrastructure/active-profile.ts";

export const SLICER_PROFILES_PORT = Symbol("SLICER_PROFILES_PORT");
export const SLICER_PROFILE_RATE_LIMIT_PORT = Symbol("SLICER_PROFILE_RATE_LIMIT_PORT");
export const SLICER_PROFILE_LOOKUP_PORT = Symbol("SLICER_PROFILE_LOOKUP_PORT");

export interface SlicerProfileLookupPort {
  listActive(profileClass: ProfileClass): Promise<readonly ListedProfile[]>;
  recommendationInputs(printerId: MachineId, filamentId: MaterialId): Promise<RecommendationInputs | null>;
  profileExists(profileId: SlicerProfileId): Promise<boolean>;
  machineExists(machineId: MachineId): Promise<boolean>;
  filamentExists(materialId: MaterialId): Promise<boolean>;
  modelExists(modelId: string): Promise<boolean>;
  makeOwnedBy(makeId: string, userId: UserId): Promise<boolean>;
  activeProfileName(profileId: SlicerProfileId): Promise<string | null>;
  compatibilityFilament(profileId: SlicerProfileId): Promise<DeviceCompatibilityFilament | null>;
}

export interface DeviceCompatibilityFilament {
  readonly materialFamily: string;
  readonly fillType?: "carbon" | "glass" | "wood" | "metal" | "glitter" | "ceramic";
  readonly needsChamber: boolean;
  readonly needsDirectDrive: boolean;
  readonly needsDrying: boolean;
  readonly extruderTempMaxC?: number;
}

export type SlicerProfileRateLimitScope = "profile_recommendation" | "calibration_create";

export interface RateLimitIdentity {
  readonly userId: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly acceptLanguage: string;
  readonly acceptEncoding: string;
}

export interface RateLimitDecision {
  readonly limited: boolean;
  readonly retryAfterSeconds: number;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
}

export interface SlicerProfileRateLimitPort {
  check(scope: SlicerProfileRateLimitScope, identity: RateLimitIdentity): RateLimitDecision;
}

export type RateLimitedResult<T> =
  { readonly limited: true; readonly rateLimit: RateLimitDecision } | { readonly limited: false; readonly rateLimit: RateLimitDecision; readonly value: T };

export type PrusaIniResult =
  { readonly ok: true; readonly ini: string; readonly params: Record<string, unknown> } | { readonly ok: false; readonly status: number; readonly error: string };

export interface SlicerProfilesPort {
  list(profileClass: ProfileClass): Promise<{ readonly profiles: readonly Omit<ListedProfile, "slicer">[] }>;
  recommend(
    userId: UserId,
    identity: RateLimitIdentity,
    printerId: MachineId,
    filamentId: MaterialId,
    intent: ProfileIntent,
  ): Promise<RateLimitedResult<ProfileRecommendationResponse>>;
  createCalibration(userId: UserId, identity: RateLimitIdentity, profileId: SlicerProfileId, input: CalibrationInput): Promise<RateLimitedResult<CalibrationResponse>>;
  calibrations(profileId: SlicerProfileId): Promise<{ readonly calibrations: readonly CalibrationResponse[] }>;
  resolvePrusaIni(profileId: SlicerProfileId): Promise<PrusaIniResult>;
  resolveDeviceProfile(
    profileId: SlicerProfileId,
  ): Promise<{ readonly ok: true; readonly name: string; readonly ini: string } | { readonly ok: false; readonly status: number; readonly error: string }>;
  compatibilityFilament(profileId: SlicerProfileId): Promise<DeviceCompatibilityFilament | null>;
}

export type { CalibrationInput, CalibrationResponse, MachineId, MaterialId, ProfileClass, ProfileIntent, ProfileRecommendationResponse };
export { SlicerProfileId } from "../domain/slicer-profile.ts";
