import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PublicApiController } from "./api/publicapi.controller.ts";
import { PublicApiService } from "./application/publicapi.service.ts";
import { PublicApiRepository } from "./infrastructure/publicapi.repository.ts";
import { AGENT_API_KEYS_PORT, PUBLICAPI_PORT, PUBLICAPI_SANCTIONS_PORT } from "./public/index.ts";
@Module({
  imports: [DatabaseModule],
  controllers: [PublicApiController],
  providers: [PublicApiRepository, PublicApiService, { provide: PUBLICAPI_PORT, useExisting: PublicApiService }, { provide: AGENT_API_KEYS_PORT, useExisting: PublicApiService }, { provide: PUBLICAPI_SANCTIONS_PORT, useExisting: PublicApiRepository }],
  exports: [PUBLICAPI_PORT, AGENT_API_KEYS_PORT, PUBLICAPI_SANCTIONS_PORT],
})
export class PublicApiModule {}
