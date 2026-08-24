import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request } from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsController } from "./metrics.controller.ts";
import { MetricsService } from "./metrics.service.ts";

function request(remoteAddress: string): Request {
  return { socket: { remoteAddress } } as Request;
}

describe("MetricsController", () => {
  let app: NestExpressApplication | undefined;
  const metrics = { metrics: vi.fn().mockResolvedValue("metric 1\n") };
  const controller = new MetricsController(metrics as never);

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("allows loopback %s", async (address) => {
    await expect(controller.render(request(address))).resolves.toBe("metric 1\n");
  });

  it.each(["10.0.0.1", "172.16.0.1", "192.168.1.1", "203.0.113.1"])("conceals the endpoint from %s", async (address) => {
    await expect(controller.render(request(address))).rejects.toMatchObject({ status: 404 });
  });

  it("serves Prometheus text with HTTP 200 over loopback", async () => {
    @Module({ controllers: [MetricsController], providers: [MetricsService] })
    class MetricsTestModule {}

    app = await NestFactory.create<NestExpressApplication>(MetricsTestModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): string | { port: number } | null }).address();
    if (address === null || typeof address === "string") throw new Error("metrics test server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("text/plain");
    expect(contentType).toContain("version=0.0.4");
  });
});
