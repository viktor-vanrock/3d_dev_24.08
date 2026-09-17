import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { ModelsController } from "./api/models.controller.ts";
import { ModelReadRepository } from "./infrastructure/model-read.repository.ts";
import { ModelMakesRepository } from "./infrastructure/model-makes.repository.ts";
import { ModelOwnerRepository } from "./infrastructure/model-owner.repository.ts";
import { ModelIndexRepository } from "./infrastructure/model-index.repository.ts";
import { MODEL_INDEX_PORT, MODEL_MAKES_PORT, MODEL_OWNER_PORT, MODEL_READ_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [ModelsController],
  providers: [
    ModelReadRepository,
    ModelMakesRepository,
    ModelOwnerRepository,
    ModelIndexRepository,
    { provide: MODEL_READ_PORT, useExisting: ModelReadRepository },
    { provide: MODEL_MAKES_PORT, useExisting: ModelMakesRepository },
    { provide: MODEL_OWNER_PORT, useExisting: ModelOwnerRepository },
    { provide: MODEL_INDEX_PORT, useExisting: ModelIndexRepository },
  ],
  exports: [MODEL_READ_PORT, MODEL_MAKES_PORT, MODEL_OWNER_PORT, MODEL_INDEX_PORT],
})
export class ModelsModule {}
