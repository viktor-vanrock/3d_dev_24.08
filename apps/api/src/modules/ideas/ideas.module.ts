import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { IdeasController } from "./api/ideas.controller.ts";
import { IdeasService } from "./application/ideas.service.ts";
import { IdeasRepository } from "./infrastructure/ideas.repository.ts";
import { IDEAS_PORT } from "./public/index.ts";
import { PermissionsModule } from "../permissions/permissions.module.ts";

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [IdeasController],
  providers: [IdeasRepository, IdeasService, { provide: IDEAS_PORT, useExisting: IdeasService }],
  exports: [IDEAS_PORT],
})
export class IdeasModule {}
