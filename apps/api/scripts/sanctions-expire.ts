import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { AppModule } from "../src/nest/app.module.ts";
import { SANCTIONS_EXPIRATION_PORT, type SanctionsExpirationPort } from "../src/modules/sanctions/public/index.ts";

export async function expireDueSanctions(): Promise<{ readonly expired: number; readonly activatedUsers: number }> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try { return await app.get<SanctionsExpirationPort>(SANCTIONS_EXPIRATION_PORT).expireDue({ limit: 500, workerId: `${hostname()}-${process.pid}` }); } finally { await app.close(); }
}
async function main(): Promise<void> { const result = await expireDueSanctions(); console.log(`sanctions-expire: expired=${result.expired} activatedUsers=${result.activatedUsers}`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error: unknown) => { console.error("sanctions-expire: worker failed", error); process.exitCode = 1; });
