import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.ts";
import { PgQueueAdapter } from "./pg-queue.adapter.ts";
import { QUEUE_PORT } from "./queue.port.ts";

@Module({
  imports: [DatabaseModule],
  providers: [{ provide: QUEUE_PORT, useClass: PgQueueAdapter }],
  exports: [QUEUE_PORT],
})
export class QueueModule {}
