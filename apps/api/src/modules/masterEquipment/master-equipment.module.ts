import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { MasterEquipmentController } from "./api/master-equipment.controller.ts";
import { MasterEquipmentService } from "./application/master-equipment.service.ts";
import { MasterEquipmentRepository } from "./infrastructure/master-equipment.repository.ts";
import { MASTER_EQUIPMENT_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [MasterEquipmentController],
  providers: [MasterEquipmentRepository, MasterEquipmentService, { provide: MASTER_EQUIPMENT_PORT, useExisting: MasterEquipmentService }],
  exports: [MASTER_EQUIPMENT_PORT],
})
export class MasterEquipmentModule {}
