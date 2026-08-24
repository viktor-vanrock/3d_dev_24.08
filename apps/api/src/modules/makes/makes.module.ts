import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { MakesController } from "./api/makes.controller.ts";
import { MakesService } from "./application/makes.service.ts";
import { MakesRepository } from "./infrastructure/makes.repository.ts";
import { MAKES_PORT, MAKES_READ_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [MakesController],
  providers: [MakesRepository, MakesService, { provide: MAKES_PORT, useExisting: MakesService }, { provide: MAKES_READ_PORT, useExisting: MakesRepository }],
  exports: [MAKES_PORT, MAKES_READ_PORT],
})
export class MakesModule {}
