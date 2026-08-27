import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { AppModule } from "../src/nest/app.module.ts";
import { SANCTIONS_RELAY_DISPATCH_PORT, type SanctionsRelayDispatchPort } from "../src/modules/sanctions/public/index.ts";

export async function dispatchSanctionRelayOutbox(): Promise<{ readonly claimed: number; readonly completed: number; readonly failed: number }> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const dispatcher = app.get<SanctionsRelayDispatchPort>(SANCTIONS_RELAY_DISPATCH_PORT);
    return await dispatcher.dispatchDueRelayCloseEvents({ limit: 100, workerId: `${hostname()}-${process.pid}` });
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  const result = await dispatchSanctionRelayOutbox();
  console.log(`sanctions-relay-outbox: claimed=${result.claimed} completed=${result.completed} failed=${result.failed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("sanctions-relay-outbox: dispatch failed", error);
    process.exitCode = 1;
  });
}
