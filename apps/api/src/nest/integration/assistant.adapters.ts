import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { requestPromptVariants } from "../../modules/assistant/public/index.ts";
import { isPromptBlocked } from "../../modules/generations/public/index.ts";
import type { UserId } from "../../modules/_kernel/brandedIds.ts";
import { GenerationsModule } from "../../modules/generations/generations.module.ts";
import { GENERATIONS_PORT, type GenerationsPort } from "../../modules/generations/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../modules/models/public/index.ts";
import { DevicesModule } from "../../modules/devices/devices.module.ts";
import { DEVICE_INCIDENT_EVENT_READ_PORT, type DeviceIncidentEventReadPort } from "../../modules/devices/public/index.ts";
import {
  ASSISTANT_EXTERNAL_PORT,
  ASSISTANT_GENERATIONS_PORT,
  type AssistantExternalPort,
  type AssistantGenerationsPort,
  type AssistantThreadEvent,
} from "../../modules/assistant/public/index.ts";
import { assertNestRateLimit } from "./rate-limit.ts";

@Injectable()
export class AssistantExternalAdapter implements AssistantExternalPort {
  constructor(
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(DEVICE_INCIDENT_EVENT_READ_PORT) private readonly events: DeviceIncidentEventReadPort,
  ) {}
  assertPromptVariantsRateLimit(request: Request, userId: UserId): Promise<void> {
    return assertNestRateLimit(request, "prompt_variants", userId);
  }
  isPromptBlocked(prompt: string): boolean {
    return isPromptBlocked(prompt);
  }
  requestPromptVariants(query: string, limit: number, batch: number, excludeLabels: readonly string[]) {
    return requestPromptVariants(query, limit, batch, excludeLabels);
  }
  async searchCatalogMatches(query: string) {
    const rows = await this.models.searchPublished(query, 4);
    return rows.map((row, index) => ({ model_id: row.id, title: row.title, relevance_rank: index + 1 }));
  }
  async loadThreadEventsAfter(threadId: string, afterSeq: number): Promise<readonly AssistantThreadEvent[]> {
    return this.events.loadThreadEventsAfter(threadId, afterSeq);
  }
}

@Injectable()
export class AssistantGenerationsAdapter implements AssistantGenerationsPort {
  constructor(@Inject(GENERATIONS_PORT) private readonly generations: GenerationsPort) {}
  create(userId: UserId, body: Readonly<Record<string, unknown>>) {
    return this.generations.create(userId, { ...body }, undefined);
  }
  detail(userId: UserId, generationId: string) {
    return this.generations.detail(userId, generationId);
  }
}

@Global()
@Module({
  imports: [DevicesModule, GenerationsModule, ModelsModule],
  providers: [
    AssistantExternalAdapter,
    AssistantGenerationsAdapter,
    { provide: ASSISTANT_EXTERNAL_PORT, useExisting: AssistantExternalAdapter },
    { provide: ASSISTANT_GENERATIONS_PORT, useExisting: AssistantGenerationsAdapter },
  ],
  exports: [ASSISTANT_EXTERNAL_PORT, ASSISTANT_GENERATIONS_PORT],
})
export class AssistantIntegrationModule {}
