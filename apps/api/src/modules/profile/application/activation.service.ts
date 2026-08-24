import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../analytics/public/index.ts";
import {
  ACTIVATION_EVENT_NAMES,
  PROFILE_HOME_TIERS,
  PROFILE_PERSONAS,
  RETURNING_AFTER_SESSIONS,
  type ActivationEventName,
  type ActivationRecord,
} from "../domain/activation.types.ts";
import type { InventoryMaterialDescription, UserInventoryRecord, UserPrinterRecord } from "../domain/inventory.types.ts";
import { ActivationRepository } from "../infrastructure/activation.repository.ts";
import { PROFILE_ACTIVATION_PRINTERS_PORT, type ProfileActivationPrintersPort } from "./profile-inventory.ports.ts";
import { ProfileFilamentsService } from "./filaments.service.ts";

export interface UpdateActivationInput {
  readonly state?: "first_run" | "returning";
  readonly primary_persona?: string;
  readonly persona_source?: string;
  readonly home_tier?: string;
  readonly first_run_completed?: boolean;
  readonly activation_checklist?: Readonly<Record<string, boolean | string>>;
  readonly home_dismissed_prompts?: Readonly<Record<string, boolean | string>>;
}

export interface ActivationProfileResponse {
  readonly activation: ActivationRecord;
  readonly printers: readonly UserPrinterRecord[];
  readonly filaments: readonly (UserInventoryRecord & InventoryMaterialDescription)[];
}

@Injectable()
export class ProfileActivationService {
  constructor(
    @Inject(ActivationRepository) private readonly repository: ActivationRepository,
    @Inject(ProfileFilamentsService) private readonly filaments: ProfileFilamentsService,
    @Inject(PROFILE_ACTIVATION_PRINTERS_PORT) private readonly printers: ProfileActivationPrintersPort,
    @Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort,
  ) {}

  async get(userId: UserId): Promise<ActivationProfileResponse> {
    let activation = await this.repository.loadAndCountSession(userId);
    if (activation.state === "first_run" && activation.sessions_seen >= RETURNING_AFTER_SESSIONS) {
      activation = (await this.repository.markReturning(userId)) ?? activation;
    }
    const [printers, filaments] = await Promise.all([this.printers.listPrinters(userId), this.filaments.list(userId)]);
    return { activation, printers, filaments: filaments.filaments };
  }

  async update(userId: UserId, input: UpdateActivationInput): Promise<{ readonly activation: ActivationRecord }> {
    const values: Record<string, unknown> = {};
    if (input.state !== undefined) values.state = input.state;
    if (input.primary_persona !== undefined && PROFILE_PERSONAS.includes(input.primary_persona as never)) {
      values.primary_persona = input.primary_persona;
      values.persona_source = input.persona_source === "inferred" ? "inferred" : "declared";
    }
    if (input.home_tier !== undefined && PROFILE_HOME_TIERS.includes(input.home_tier as never)) values.home_tier = input.home_tier;
    if (input.first_run_completed === true) {
      values.first_run_completed_at = new Date();
      values.state = "returning";
    }
    if (input.activation_checklist !== undefined) values.activation_checklist = input.activation_checklist;
    if (input.home_dismissed_prompts !== undefined) values.home_dismissed_prompts = input.home_dismissed_prompts;
    if (Object.keys(values).length === 0) throw new BadRequestException();
    const activation = await this.repository.update(userId, values);
    if (activation === null) throw new NotFoundException();
    return { activation };
  }

  async event(userId: UserId, anonId: string | null, eventName: string, props: Readonly<Record<string, boolean | number | string | null>>): Promise<{ readonly ok: true }> {
    if (!ACTIVATION_EVENT_NAMES.includes(eventName as ActivationEventName)) throw new BadRequestException();
    await this.analytics.emitEvent({ eventName: eventName as ActivationEventName, anonId, userId, props });
    return { ok: true };
  }
}
