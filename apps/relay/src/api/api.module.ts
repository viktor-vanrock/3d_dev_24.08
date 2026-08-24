import { Module } from "@nestjs/common";
import { RelayApiClient } from "./relay-api-client.service.ts";

@Module({ providers: [RelayApiClient], exports: [RelayApiClient] })
export class RelayApiModule {}
