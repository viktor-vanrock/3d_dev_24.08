import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PERMISSION_GRANTS_REPOSITORY, PermissionsService } from "./application/permissions.service.ts";
import { PermissionGuard } from "./guards/permission.guard.ts";
import { PermissionGrantsPgRepository } from "./infrastructure/permission-grants.repository.ts";

@Module({
  imports: [DatabaseModule],
  providers: [
    PermissionGrantsPgRepository,
    PermissionsService,
    PermissionGuard,
    { provide: PERMISSION_GRANTS_REPOSITORY, useExisting: PermissionGrantsPgRepository },
  ],
  exports: [PermissionsService, PermissionGuard],
})
export class PermissionsModule {}
