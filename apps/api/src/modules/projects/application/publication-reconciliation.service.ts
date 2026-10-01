import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { MODEL_INDEX_PORT, type ModelIndexPort } from "../../models/public/index.ts";

@Injectable()
export class PublicationReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicationReconciliationService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(MODEL_INDEX_PORT) private readonly index: ModelIndexPort) {}

  onModuleInit(): void {
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch(() => this.logger.error("Reconciliation failed"));
    }, 10 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer !== null) clearInterval(this.reconcileTimer);
  }

  async reconcile(): Promise<{ readonly fixed: number }> {
    const missing = await this.index.missingPublished(100);
    if (missing.length === 0) return { fixed: 0 };
    this.logger.warn("Reconciliation found models missing search index jobs");

    let fixed = 0;
    for (const row of missing) {
      try {
        await this.index.enqueue(row.modelId, row.document);
        fixed += 1;
      } catch {
        this.logger.warn("Reconciliation failed to enqueue search index job");
      }
    }
    this.logger.log("Reconciliation completed");
    return { fixed };
  }
}
