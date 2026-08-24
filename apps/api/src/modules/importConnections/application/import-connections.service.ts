import { randomBytes } from "node:crypto";
import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { ImportProviderUnavailableError, InvalidImportCredentialsError } from "../domain/import-connections.ts";
import { ImportConnectionsRepository } from "../infrastructure/import-connections.repository.ts";
import { IMPORT_CONNECTIONS_EXTERNAL_PORT, type ImportConnectionsExternalPort, type ImportConnectionsPort } from "../public/index.ts";

@Injectable()
export class ImportConnectionsService implements ImportConnectionsPort {
  constructor(
    @Inject(ImportConnectionsRepository) private readonly repository: ImportConnectionsRepository,
    @Inject(IMPORT_CONNECTIONS_EXTERNAL_PORT) private readonly external: ImportConnectionsExternalPort,
  ) {}

  exists(input: { readonly connectionId: string; readonly userId: UserId; readonly sourcePlatform: string }): Promise<boolean> {
    return this.repository.exists(input);
  }

  async connect(userId: UserId, input: { readonly sourcePlatform: unknown; readonly username: unknown; readonly apiKey: unknown }) {
    const sourcePlatform = typeof input.sourcePlatform === "string" ? input.sourcePlatform : "";
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (sourcePlatform !== "cults3d") throw new BadRequestException();
    if (!apiKey) throw new BadRequestException();
    try {
      const models = await this.external.validateCredentials({ username, apiKey });
      const connectionId = await this.repository.upsertCults3d(userId, username, this.external.encryptCredentials(apiKey));
      await this.repository.markVerified(connectionId);
      return { id: connectionId, source_platform: "cults3d" as const, ownership_status: "verified" as const, models_found: models.length };
    } catch (error) {
      this.rethrowProvider(error);
    }
  }

  list(userId: UserId) {
    return this.repository.list(userId);
  }

  async listModels(userId: UserId, connectionId: string) {
    let stored;
    try {
      stored = await this.repository.findCults3dCredential(userId, connectionId);
    } catch {
      throw new BadGatewayException();
    }
    if (stored === null) throw new NotFoundException();
    try {
      const apiKey = this.external.decryptCredentials(stored.credential_enc);
      const models = await this.external.listModels({ username: stored.external_username ?? "", apiKey });
      return { models };
    } catch (error) {
      this.rethrowProvider(error);
    }
  }

  async requestChallenge(userId: UserId, connectionId: string, rawTarget: unknown) {
    const target = typeof rawTarget === "string" ? rawTarget.trim() : "";
    if (!target) throw new BadRequestException();
    const token = `3mf-verify-${randomBytes(9).toString("base64url")}`;
    if (!(await this.repository.setChallenge(userId, connectionId, token, target))) throw new NotFoundException();
    return { token };
  }

  async verifyChallenge(userId: UserId, connectionId: string, rawObservedText: unknown) {
    const connection = await this.repository.findChallenge(userId, connectionId);
    if (connection === null) throw new NotFoundException();
    if (!connection.challenge_token) throw new ConflictException();
    const observedText = typeof rawObservedText === "string" ? rawObservedText : "";
    const ownershipStatus: "verified" | "rejected" = observedText.includes(connection.challenge_token) ? "verified" : "rejected";
    await this.repository.setOwnershipStatus(connectionId, ownershipStatus);
    return { ownership_status: ownershipStatus };
  }

  private rethrowProvider(error: unknown): never {
    if (error instanceof InvalidImportCredentialsError) throw new BadRequestException();
    if (error instanceof ImportProviderUnavailableError) throw new BadGatewayException();
    throw new BadGatewayException();
  }
}
