import { Global, Module } from "@nestjs/common";
import { RuntimeLogger } from "../observability/runtime-logger.ts";
import { SessionVerifier } from "./session-verifier.ts";
import { DatabaseModule } from "../database/database.module.ts";

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [RuntimeLogger, SessionVerifier],
  exports: [SessionVerifier],
})
export class SessionVerifierModule {}
