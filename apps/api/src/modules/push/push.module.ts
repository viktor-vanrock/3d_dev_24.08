import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PushController } from "./api/push.controller.ts";
import { PushService } from "./application/push.service.ts";
import { PushRepository } from "./infrastructure/push.repository.ts";
import { VapidPublicKeyProvider } from "./infrastructure/vapid-public-key.provider.ts";
import { WebPushDelivery } from "./infrastructure/web-push.delivery.ts";
import { PUSH_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [PushController],
  providers: [PushRepository, VapidPublicKeyProvider, WebPushDelivery, PushService, { provide: PUSH_PORT, useExisting: PushService }],
  exports: [PUSH_PORT],
})
export class PushModule {}
