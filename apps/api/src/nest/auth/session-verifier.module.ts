import { Global, Module } from "@nestjs/common";
import { RuntimeLogger } from "../observability/runtime-logger.ts";
import { SessionVerifier } from "./session-verifier.ts";

@Global()
@Module({
  providers: [RuntimeLogger, SessionVerifier],
  exports: [SessionVerifier],
})
export class SessionVerifierModule {}
