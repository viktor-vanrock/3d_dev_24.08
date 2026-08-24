import { Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { recommendProfile } from "../domain/profile-matcher.ts";
import {
  MachineNotFoundError,
  MakeNotFoundError,
  MaterialNotFoundError,
  ModelNotFoundError,
  SlicerProfileNotFoundError,
  serializeCalibration,
  serializeRecommendation,
  type CalibrationInput,
  type MachineId,
  type MaterialId,
  type ProfileClass,
  type ProfileIntent,
  type SlicerProfileId,
} from "../domain/slicer-profile.ts";
import { MeshSlicerProfileAdapter } from "../infrastructure/mesh-slicer-profile.adapter.ts";
import { SlicerProfilesRepository } from "../infrastructure/slicer-profiles.repository.ts";
import type { SlicerProfilesPort, RateLimitedResult } from "../public/index.ts";
import { SLICER_PROFILE_LOOKUP_PORT, type SlicerProfileLookupPort } from "../public/index.ts";
import { SLICER_PROFILE_RATE_LIMIT_PORT, type RateLimitIdentity, type SlicerProfileRateLimitPort } from "../public/index.ts";

const ORCASLICER_RESOLVABLE_NAMES = new Set(["Snapmaker U1 (0.4 nozzle)", "0.20 Standard @Snapmaker U1 (0.4 nozzle)", "Snapmaker PLA @U1"]);

@Injectable()
export class SlicerProfilesService implements SlicerProfilesPort {
  constructor(
    @Inject(SLICER_PROFILE_LOOKUP_PORT) private readonly lookup: SlicerProfileLookupPort,
    @Inject(SLICER_PROFILE_RATE_LIMIT_PORT) private readonly rateLimit: SlicerProfileRateLimitPort,
    @Inject(SlicerProfilesRepository) private readonly repository: SlicerProfilesRepository,
    @Inject(MeshSlicerProfileAdapter) private readonly mesh: MeshSlicerProfileAdapter,
  ) {}

  async list(profileClass: ProfileClass) {
    const profiles = (await this.lookup.listActive(profileClass))
      .filter(({ slicer, name }) => slicer === "prusaslicer" || (slicer === "orcaslicer" && ORCASLICER_RESOLVABLE_NAMES.has(name)))
      .map(({ slicer: _slicer, ...profile }) => profile);
    return { profiles };
  }

  async recommend(_userId: UserId, identity: RateLimitIdentity, printerId: MachineId, filamentId: MaterialId, intent: ProfileIntent) {
    const rateLimit = this.rateLimit.check("profile_recommendation", identity);
    if (rateLimit.limited) return { limited: true, rateLimit } satisfies RateLimitedResult<never>;
    const inputs = await this.lookup.recommendationInputs(printerId, filamentId);
    if (inputs === null) throw new SlicerProfileNotFoundError();
    const recommendation = recommendProfile(inputs.printer, inputs.filament, inputs.profiles, intent);
    if (recommendation === null) throw new SlicerProfileNotFoundError();
    return {
      limited: false,
      rateLimit,
      value: serializeRecommendation(printerId, filamentId, intent, recommendation),
    };
  }

  async createCalibration(userId: UserId, identity: RateLimitIdentity, profileId: SlicerProfileId, input: CalibrationInput) {
    const rateLimit = this.rateLimit.check("calibration_create", identity);
    if (rateLimit.limited) return { limited: true, rateLimit } satisfies RateLimitedResult<never>;
    if (!(await this.lookup.profileExists(profileId))) throw new SlicerProfileNotFoundError();
    if (!(await this.lookup.machineExists(input.machineId))) throw new MachineNotFoundError();
    if (!(await this.lookup.filamentExists(input.materialId))) throw new MaterialNotFoundError();
    if (input.modelId !== null && !(await this.lookup.modelExists(input.modelId))) throw new ModelNotFoundError();
    if (input.makeId !== null && !(await this.lookup.makeOwnedBy(input.makeId, userId))) throw new MakeNotFoundError();
    return {
      limited: false,
      rateLimit,
      value: serializeCalibration(await this.repository.createCalibration(profileId, userId, input)),
    };
  }

  async calibrations(profileId: SlicerProfileId) {
    if (!(await this.lookup.profileExists(profileId))) throw new SlicerProfileNotFoundError();
    return { calibrations: (await this.repository.listCalibrations(profileId)).map(serializeCalibration) };
  }

  resolvePrusaIni(profileId: SlicerProfileId) {
    return this.mesh.resolvePrusaIni(profileId);
  }

  async resolveDeviceProfile(profileId: SlicerProfileId) {
    const name = await this.lookup.activeProfileName(profileId);
    if (name === null) return { ok: false as const, status: 404, error: "profile_not_found" };
    const resolved = await this.mesh.resolvePrusaIni(profileId);
    return resolved.ok ? { ok: true as const, name, ini: resolved.ini } : { ok: false as const, status: resolved.status, error: resolved.error };
  }

  compatibilityFilament(profileId: SlicerProfileId) {
    return this.lookup.compatibilityFilament(profileId);
  }
}
