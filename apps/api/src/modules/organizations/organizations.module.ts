import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { OrganizationsController } from "./api/organizations.controller.ts";
import { OrganizationsService } from "./application/organizations.service.ts";
import { OrganizationsRepository } from "./infrastructure/organizations.repository.ts";
import { ORGANIZATIONS_PORT } from "./public/index.ts";

@Module({
  imports: [DatabaseModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsRepository, OrganizationsService, { provide: ORGANIZATIONS_PORT, useExisting: OrganizationsService }],
  exports: [ORGANIZATIONS_PORT],
})
export class OrganizationsModule {}
