import { Module } from "@nestjs/common";
import { GatewayModule } from "../gateway/gateway.module.ts";
import { RelayControlHttpServer } from "./relay-control-http.server.ts";

@Module({ imports: [GatewayModule], providers: [RelayControlHttpServer] })
export class RelayControlModule {}
