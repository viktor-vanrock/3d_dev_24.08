import { Module } from "@nestjs/common";
import { MasterController } from "./api/master.controller.ts";
import { MasterService } from "./application/master.service.ts";
import { MASTER_PORT } from "./public/index.ts";

@Module({
  controllers: [MasterController],
  providers: [MasterService, { provide: MASTER_PORT, useExisting: MasterService }],
  exports: [MASTER_PORT],
})
export class MasterModule {}
