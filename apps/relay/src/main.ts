import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";
import { RELAY_CONFIG, type RelayConfig } from "./config/relay-config.ts";
import { RelayLogger } from "./observability/relay-logger.ts";

export async function startRelay(): Promise<void> {
  const application = await NestFactory.create(AppModule, { logger: false });
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await application.close();
    } catch {
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  const config = application.get<RelayConfig>(RELAY_CONFIG);
  const logger = application.get(RelayLogger);
  await application.listen(config.observability.port, config.observability.host);
  logger.info(
    { event: "relay_observability_listening", outcome: "ready" },
    "relay health, readiness and metrics listener started",
  );
}

if (process.env.NODE_ENV !== "test") {
  void startRelay().catch(() => {
    process.stderr.write("relay startup failed\n");
    process.exitCode = 1;
  });
}
