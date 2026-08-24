import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { MasterServicesController } from "./api/master-services.controller.ts";
import { MasterServicesService } from "./application/master-services.service.ts";
import { MasterServicesRepository } from "./infrastructure/master-services.repository.ts";
import { MASTER_SERVICES_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [MasterServicesController],
  providers: [MasterServicesRepository, MasterServicesService, { provide: MASTER_SERVICES_PORT, useExisting: MasterServicesService }],
  exports: [MASTER_SERVICES_PORT],
})
export class MasterServicesModule {}
