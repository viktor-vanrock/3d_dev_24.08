import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { deleteObject } from "../../../storage/s3.ts";
import { UploadSessionRepository } from "../infrastructure/upload-session.repository.ts";

@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly sessions: UploadSessionRepository) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.cleanupExpired(), 10 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  async cleanupExpired(): Promise<void> {
    const expired = await this.sessions.findExpired(50);
    for (const session of expired) {
      try {
        if (session.object_key !== null) await deleteObject(session.object_key);
        await this.sessions.markAbandoned(session.id);
      } catch (error) {
        this.logger.warn(`Cleanup: не удалось удалить ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
