import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { SlicerProfilesController } from "./api/slicer-profiles.controller.ts";
import { SlicerProfilesService } from "./application/slicer-profiles.service.ts";
import { InMemorySlicerProfileRateLimitAdapter } from "./infrastructure/in-memory-rate-limit.adapter.ts";
import { MeshSlicerProfileAdapter } from "./infrastructure/mesh-slicer-profile.adapter.ts";
import { SlicerProfilesRepository } from "./infrastructure/slicer-profiles.repository.ts";
import { SlicerProfileLookupAdapter } from "./infrastructure/slicer-profile-lookup.adapter.ts";
import { SLICER_PROFILES_PORT, SLICER_PROFILE_LOOKUP_PORT, SLICER_PROFILE_RATE_LIMIT_PORT } from "./public/index.ts";

const INTERNAL_PROVIDERS = [
  SlicerProfilesRepository,
  SlicerProfileLookupAdapter,
  MeshSlicerProfileAdapter,
  InMemorySlicerProfileRateLimitAdapter,
  { provide: SLICER_PROFILE_RATE_LIMIT_PORT, useExisting: InMemorySlicerProfileRateLimitAdapter },
  SlicerProfilesService,
  { provide: SLICER_PROFILES_PORT, useExisting: SlicerProfilesService },
  { provide: SLICER_PROFILE_LOOKUP_PORT, useExisting: SlicerProfileLookupAdapter },
];

@Module({
  imports: [DatabaseModule],
  controllers: [SlicerProfilesController],
  providers: INTERNAL_PROVIDERS,
  exports: [SLICER_PROFILES_PORT, SLICER_PROFILE_LOOKUP_PORT],
})
export class SlicerProfilesModule {}
