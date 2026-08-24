import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { GenerationsController } from "./api/generations.controller.ts";
import { GenerationsService } from "./application/generations.service.ts";
import { GenerationsRepository } from "./infrastructure/generations.repository.ts";
import { GENERATIONS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [GenerationsController],
  providers: [GenerationsRepository, GenerationsService, { provide: GENERATIONS_PORT, useExisting: GenerationsService }],
  exports: [GENERATIONS_PORT],
})
export class GenerationsModule {}
