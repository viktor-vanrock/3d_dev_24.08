import { Global, Module } from "@nestjs/common";
import { SessionRegistry } from "./session-registry.ts";

@Global()
@Module({ providers: [SessionRegistry], exports: [SessionRegistry] })
export class SessionModule {}
