import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ProjectsModule } from "../projects/projects.module.ts";
import { ModelsController } from "./api/models.controller.ts";
import { ModelReadRepository } from "./infrastructure/model-read.repository.ts";
import { ModelMakesRepository } from "./infrastructure/model-makes.repository.ts";
import { ModelOwnerRepository } from "./infrastructure/model-owner.repository.ts";
import { MODEL_MAKES_PORT, MODEL_OWNER_PORT, MODEL_READ_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule, ProjectsModule],
  controllers: [ModelsController],
  providers: [
    ModelReadRepository,
    ModelMakesRepository,
    ModelOwnerRepository,
    { provide: MODEL_READ_PORT, useExisting: ModelReadRepository },
    { provide: MODEL_MAKES_PORT, useExisting: ModelMakesRepository },
    { provide: MODEL_OWNER_PORT, useExisting: ModelOwnerRepository },
  ],
  exports: [MODEL_READ_PORT, MODEL_MAKES_PORT, MODEL_OWNER_PORT],
})
export class ModelsModule {}
