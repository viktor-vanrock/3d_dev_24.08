import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { MakersController } from "./api/makers.controller.ts";
import { MakersService } from "./application/makers.service.ts";
import { MakerFollowRepository } from "./infrastructure/maker-follow.repository.ts";
import { MakersRepository } from "./infrastructure/makers.repository.ts";
import { MAKER_FOLLOW_READ_PORT, MAKERS_PORT } from "./public/index.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [MakersController],
  providers: [
    MakerFollowRepository,
    MakersRepository,
    MakersService,
    { provide: MAKER_FOLLOW_READ_PORT, useExisting: MakerFollowRepository },
    { provide: MAKERS_PORT, useExisting: MakersService },
  ],
  exports: [MAKER_FOLLOW_READ_PORT, MAKERS_PORT],
})
export class MakersModule {}
