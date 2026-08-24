import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import type { PoolClient } from "pg";
import { decryptIdentity, encryptIdentity } from "../../modules/auth/public/index.ts";
import { prusaConnectClient, PrusaAuthError } from "../../modules/printers/public/index.ts";
import { matchPrusaModel } from "../../modules/catalog/public/index.ts";
import { createResearchApiKeyVerifier } from "../../modules/publicapi/public/legacy.ts";
import { getPrinterResearchObjectPresignedUrl, getPrinterResearchUploadPresignedUrl } from "../../storage/s3.ts";
import { lockOwnedUser, markOwnedActivationHasPrinter } from "../../modules/profile/public/legacy.ts";
import { AnalyticsModule } from "../../modules/analytics/analytics.module.ts";
import { ANALYTICS_PORT, type AnalyticsPort } from "../../modules/analytics/public/index.ts";
import { UserId, type UserId as UserIdType } from "../../modules/_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, PROFILE_CONTENT_PORT, type ProfileAuthPort, type ProfileContentPort } from "../../modules/profile/public/index.ts";
import { pool } from "../../db/client.ts";
import {
  PRINTER_ACTIVATION_PORT,
  PRINTER_ANALYTICS_PORT,
  PRINTER_CATALOG_MATCH_PORT,
  PRINTER_PRUSA_PORT,
  PRINTER_RESEARCH_AUTH_PORT,
  PRINTER_STORAGE_PORT,
  type PrinterActivationPort,
  type PrinterAnalyticsPort,
  type PrinterCatalogMatchPort,
  type PrinterPrusaPort,
  type PrinterQueryExecutor,
  type PrinterResearchAuthPort,
  type PrinterStoragePort,
} from "../../modules/printers/public/index.ts";
import { SessionVerifier } from "../auth/session-verifier.ts";

@Injectable()
export class PrinterResearchAuthAdapter implements PrinterResearchAuthPort {
  constructor(
    @Inject(SessionVerifier) private readonly sessions: SessionVerifier,
    @Inject(PROFILE_CONTENT_PORT) private readonly profiles: ProfileContentPort,
    @Inject(PROFILE_AUTH_PORT) private readonly profileAuth: ProfileAuthPort,
  ) {}

  async resolveUser(identity: { readonly authorization: string | undefined; readonly cookie: string | undefined }): Promise<UserIdType | null> {
    const session = await this.sessions.readSession({ headers: { authorization: identity.authorization, cookie: identity.cookie } } as Request);
    if (session !== null) return UserId(session.id);
    const token = /^Bearer (\S+)$/.exec(identity.authorization ?? "")?.[1];
    const principal = token === undefined ? null : await createResearchApiKeyVerifier(pool, this.profileAuth).verify(token);
    return principal === null ? null : UserId(principal.userId);
  }

  async isResearcher(userId: UserIdType): Promise<boolean> {
    return (await this.profiles.role(userId)) === "researcher";
  }
}

@Injectable()
export class PrinterPrusaAdapter implements PrinterPrusaPort {
  async listPrinters(apiKey: string) {
    try {
      return { ok: true as const, printers: await prusaConnectClient.listPrinters(apiKey) };
    } catch (error) {
      return { ok: false as const, reason: error instanceof PrusaAuthError ? ("auth" as const) : ("unavailable" as const) };
    }
  }
  encryptKey(apiKey: string): Buffer {
    return encryptIdentity({ api_key: apiKey });
  }
  decryptKey(value: Buffer): string | null {
    try {
      const decoded = decryptIdentity(value) as { api_key?: unknown };
      return typeof decoded.api_key === "string" ? decoded.api_key : null;
    } catch {
      return null;
    }
  }
}

@Injectable()
export class PrinterCatalogMatchAdapter implements PrinterCatalogMatchPort {
  matchPrusaModel(modelName: string): Promise<string | null> {
    return matchPrusaModel(modelName);
  }
}

@Injectable()
export class PrinterStorageAdapter implements PrinterStoragePort {
  uploadUrl(key: string, contentType: string): Promise<string | null> {
    return getPrinterResearchUploadPresignedUrl(key, contentType);
  }
  objectUrl(key: string): Promise<string | null> {
    return getPrinterResearchObjectPresignedUrl(key);
  }
}

@Injectable()
export class PrinterAnalyticsAdapter implements PrinterAnalyticsPort {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}
  async printerUpserted(input: Parameters<PrinterAnalyticsPort["printerUpserted"]>[0]): Promise<void> {
    await this.analytics.emitEvent({
      eventName: "printer_card_upserted",
      anonId: input.anonId,
      userId: input.userId,
      props: {
        printer_id: input.printerId,
        slug: input.slug,
        brand: input.brand,
        model: input.model,
        confidence: input.confidence,
        gaps_count: input.gapsCount,
        sources_count: input.sourcesCount,
        filled_by: input.filledBy,
        is_new: input.isNew,
      },
    });
  }
}

@Injectable()
export class PrinterActivationAdapter implements PrinterActivationPort {
  lockUser(userId: UserIdType, executor: PrinterQueryExecutor): Promise<boolean> {
    return lockOwnedUser(executor as PoolClient, userId);
  }
  async setHasPrinter(userId: UserIdType, value: boolean, executor?: PrinterQueryExecutor): Promise<void> {
    if (executor === undefined) throw new Error("printer activation update requires a transaction");
    await markOwnedActivationHasPrinter(executor as PoolClient, userId, value);
  }
}

@Global()
@Module({
  imports: [AnalyticsModule],
  providers: [
    PrinterResearchAuthAdapter,
    PrinterPrusaAdapter,
    PrinterCatalogMatchAdapter,
    PrinterStorageAdapter,
    PrinterAnalyticsAdapter,
    PrinterActivationAdapter,
    { provide: PRINTER_RESEARCH_AUTH_PORT, useExisting: PrinterResearchAuthAdapter },
    { provide: PRINTER_PRUSA_PORT, useExisting: PrinterPrusaAdapter },
    { provide: PRINTER_CATALOG_MATCH_PORT, useExisting: PrinterCatalogMatchAdapter },
    { provide: PRINTER_STORAGE_PORT, useExisting: PrinterStorageAdapter },
    { provide: PRINTER_ANALYTICS_PORT, useExisting: PrinterAnalyticsAdapter },
    { provide: PRINTER_ACTIVATION_PORT, useExisting: PrinterActivationAdapter },
  ],
  exports: [PRINTER_RESEARCH_AUTH_PORT, PRINTER_PRUSA_PORT, PRINTER_CATALOG_MATCH_PORT, PRINTER_STORAGE_PORT, PRINTER_ANALYTICS_PORT, PRINTER_ACTIVATION_PORT],
})
export class PrintersIntegrationModule {}
