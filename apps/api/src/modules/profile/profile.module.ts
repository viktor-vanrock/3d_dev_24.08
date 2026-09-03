import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ProfileController } from "./api/profile.controller.ts";
import { ProfileInventoryController, ProfilePrintersController } from "./api/profile-inventory.controller.ts";
import { ProfileAggregatesAdapter } from "./application/profile-aggregates.adapter.ts";
import { ProfileService } from "./application/profile.service.ts";
import { ProfileActivationService } from "./application/activation.service.ts";
import { ProfileFilamentsService } from "./application/filaments.service.ts";
import { ProfileMaterialsService } from "./application/materials.service.ts";
import { ProfilePrintersService } from "./application/printers.service.ts";
import { ProfileActivationPrintersAdapter, ProfileMaterialCatalogAdapter } from "./application/profile-owner-read.adapters.ts";
import { ProfileRepository } from "./infrastructure/profile.repository.ts";
import { ProfileStorageAdapter } from "./infrastructure/profile-storage.adapter.ts";
import { ActivationRepository } from "./infrastructure/activation.repository.ts";
import { ProfileFilamentsRepository } from "./infrastructure/filaments.repository.ts";
import { ProfileMaterialsRepository } from "./infrastructure/materials.repository.ts";
import { PROFILE_AGGREGATES_PORT, PROFILE_AUTH_PORT, PROFILE_CONTENT_PORT, PROFILE_MASTER_PORT, PROFILE_READ_PORT, PROFILE_SANCTIONS_PORT } from "./public/index.ts";
import { PROFILE_ADMIN_PORT } from "./public/index.ts";
import { PermissionsModule } from "../permissions/public/index.ts";
import { PROFILE_ACTIVATION_PRINTERS_PORT, PROFILE_MATERIAL_CATALOG_PORT } from "./application/profile-inventory.ports.ts";

@Global()
@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [ProfileController, ProfileInventoryController, ProfilePrintersController],
  providers: [
    ProfileRepository,
    ProfileStorageAdapter,
    ProfileAggregatesAdapter,
    ProfileService,
    ActivationRepository,
    ProfileFilamentsRepository,
    ProfileMaterialsRepository,
    ProfileActivationPrintersAdapter,
    ProfileMaterialCatalogAdapter,
    ProfileActivationService,
    ProfileFilamentsService,
    ProfileMaterialsService,
    ProfilePrintersService,
    { provide: PROFILE_AGGREGATES_PORT, useExisting: ProfileAggregatesAdapter },
    { provide: PROFILE_ACTIVATION_PRINTERS_PORT, useExisting: ProfileActivationPrintersAdapter },
    { provide: PROFILE_MATERIAL_CATALOG_PORT, useExisting: ProfileMaterialCatalogAdapter },
    { provide: PROFILE_READ_PORT, useExisting: ProfileRepository },
    { provide: PROFILE_ADMIN_PORT, useExisting: ProfileRepository },
    { provide: PROFILE_AUTH_PORT, useExisting: ProfileRepository },
    { provide: PROFILE_CONTENT_PORT, useExisting: ProfileRepository },
    { provide: PROFILE_MASTER_PORT, useExisting: ProfileRepository },
    { provide: PROFILE_SANCTIONS_PORT, useExisting: ProfileRepository },
  ],
  exports: [PROFILE_READ_PORT, PROFILE_ADMIN_PORT, PROFILE_AUTH_PORT, PROFILE_CONTENT_PORT, PROFILE_MASTER_PORT, PROFILE_SANCTIONS_PORT],
})
export class ProfileModule {}
