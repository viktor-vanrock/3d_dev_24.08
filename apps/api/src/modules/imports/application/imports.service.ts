import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { ImportsRepository } from "../infrastructure/imports.repository.ts";
import { IMPORTS_CONNECTION_READ_PORT, type ImportsConnectionReadPort, type ImportsPort } from "../public/index.ts";

@Injectable()
export class ImportsService implements ImportsPort {
  constructor(
    @Inject(ImportsRepository) private readonly repository: ImportsRepository,
    @Inject(IMPORTS_CONNECTION_READ_PORT) private readonly connections: ImportsConnectionReadPort,
  ) {}

  async enqueue(userId: UserId, input: { readonly connectionId: string; readonly sourcePlatform: string; readonly externalIds: readonly string[] }) {
    const rawConnectionId: unknown = input.connectionId;
    const rawSourcePlatform: unknown = input.sourcePlatform;
    const rawExternalIds: unknown = input.externalIds;
    if (typeof rawConnectionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawConnectionId)) throw new BadRequestException();
    if (typeof rawSourcePlatform !== "string" || rawSourcePlatform.length === 0) throw new BadRequestException();
    if (!Array.isArray(rawExternalIds)) throw new BadRequestException();
    const externalIds = [
      ...new Set(
        rawExternalIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
    if (externalIds.length === 0) throw new BadRequestException();
    if (!(await this.connections.exists({ connectionId: rawConnectionId, userId, sourcePlatform: rawSourcePlatform }))) throw new NotFoundException();
    const jobId = await this.repository.enqueue(userId, rawConnectionId, rawSourcePlatform, externalIds);
    return { id: jobId, status: "queued" as const, total_count: externalIds.length, done_count: 0 as const, failed_count: 0 as const };
  }

  async list(userId: UserId) {
    return { jobs: await this.repository.list(userId) };
  }

  async detail(userId: UserId, id: string) {
    const job = await this.repository.find(userId, id);
    if (job === null) throw new NotFoundException();
    return { ...job, items: await this.repository.items(id) };
  }
}
