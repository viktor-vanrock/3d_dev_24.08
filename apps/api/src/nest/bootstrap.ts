import "reflect-metadata";

import type { Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.ts";
import { DEFAULT_NEST_PORT, getAllowedOrigins } from "./config/runtime-config.ts";
import { configureOpenApi, createOpenApiDocument, shouldWriteOpenApiContract, writeOpenApiContract } from "./openapi/setup-openapi.ts";

export const DEFAULT_NEST_HOST = "0.0.0.0";
export { DEFAULT_NEST_PORT, resolveNestPort } from "./config/runtime-config.ts";

export async function createNestApp(rootModule: Type<unknown> = AppModule): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(rootModule);
  const config = app.get(ConfigService);

  app.set("trust proxy", true);
  app.enableCors({
    origin: config.get<string>("NODE_ENV") === "production" ? getAllowedOrigins() : true,
    credentials: true,
  });
  configureOpenApi(app);

  return app;
}

export async function startNestApp(): Promise<NestExpressApplication> {
  const app = await createNestApp();
  const config = app.get(ConfigService);
  const port = config.get<number>("PORT") ?? DEFAULT_NEST_PORT;

  app.enableShutdownHooks();
  await app.init();
  if (shouldWriteOpenApiContract(config.get<string>("NODE_ENV"))) {
    await writeOpenApiContract(createOpenApiDocument(app));
  }
  await app.listen(port, DEFAULT_NEST_HOST);
  return app;
}
