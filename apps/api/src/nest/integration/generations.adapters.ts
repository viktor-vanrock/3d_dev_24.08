import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { detectImageFormat, embedSearchQuery, toPgVectorLiteral } from "../../modules/models/public/index.ts";
import {
  countGenerationPhotos,
  getGenerationObjectStream,
  isGenerationStorageConfigured,
  isModelsStorageConfigured,
  modelObjectKey,
  putGenerationObject,
  putModelObjectStream,
} from "../../storage/s3.ts";
import type { GenerationId, UserId } from "../../modules/_kernel/brandedIds.ts";
import { AnalyticsModule } from "../../modules/analytics/analytics.module.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../modules/analytics/public/index.ts";
import { generationAssetContentType, generationAssetExtension } from "../../modules/generations/public/index.ts";
import { GENERATIONS_EXTERNAL_PORT, type GenerationsExternalPort } from "../../modules/generations/public/index.ts";
import { assertNestRateLimit } from "./rate-limit.ts";

@Injectable()
export class GenerationsExternalAdapter implements GenerationsExternalPort {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}

  storageConfigured(): boolean {
    return isGenerationStorageConfigured();
  }
  countPhotos(prefix: string): Promise<number> {
    return countGenerationPhotos(prefix);
  }
  putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
    return putGenerationObject(key, body, contentType);
  }
  getObject(key: string) {
    return getGenerationObjectStream(key);
  }
  detectImage(body: Buffer) {
    return detectImageFormat(body);
  }
  embed(text: string, timeoutMs?: number) {
    return embedSearchQuery(text, timeoutMs);
  }
  vectorLiteral(vector: readonly number[]): string {
    return toPgVectorLiteral(vector);
  }
  modelsStorageConfigured(): boolean {
    return isModelsStorageConfigured();
  }
  async copyToModel(input: { readonly generationKey: string; readonly modelId: string; readonly role: string }) {
    const object = await getGenerationObjectStream(input.generationKey);
    if (object === null) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const s3Key = modelObjectKey(input.modelId, input.role, generationAssetExtension(input.generationKey));
    await putModelObjectStream(s3Key, Readable.from(body), generationAssetContentType(input.generationKey));
    return { s3Key, sizeBytes: body.length, checksum: createHash("sha256").update(body).digest() };
  }
  assertDownloadRateLimit(request: Request, userId: UserId): Promise<void> {
    return assertNestRateLimit(request, "download", userId);
  }
  async emitStarted(input: {
    readonly generationId: GenerationId;
    readonly userId: UserId;
    readonly branch: string;
    readonly assistantOfferId?: string;
    readonly sourceGenerationId?: string;
  }): Promise<void> {
    await this.analytics.emitEvent({
      anonId: null,
      eventName: "generation_start",
      userId: input.userId,
      props: {
        generation_id: input.generationId,
        branch: input.branch,
        ...(input.assistantOfferId ? { assistant_offer_id: input.assistantOfferId } : {}),
        ...(input.sourceGenerationId ? { source_generation_id: input.sourceGenerationId } : {}),
      },
    });
  }
  async emitDownloaded(input: { readonly generationId: GenerationId; readonly userId: UserId; readonly branch: string }): Promise<void> {
    await this.analytics.emitEvent({ anonId: null, eventName: "generation_download", userId: input.userId, props: { generation_id: input.generationId, branch: input.branch } });
  }
}

@Global()
@Module({
  imports: [AnalyticsModule],
  providers: [GenerationsExternalAdapter, { provide: GENERATIONS_EXTERNAL_PORT, useExisting: GenerationsExternalAdapter }],
  exports: [GENERATIONS_EXTERNAL_PORT],
})
export class GenerationsIntegrationModule {}
