import { Controller, Get, Header, Inject, NotFoundException, Req } from "@nestjs/common";
import type { Request } from "express";
import { MetricsService } from "./metrics.service.ts";
import { Internal } from "../../modules/permissions/decorators/internal.decorator.ts";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

@Controller()
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get("metrics")
  @Internal()
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("cache-control", "no-store")
  async render(@Req() request: Request): Promise<string> {
    // Security: /metrics must never be exposed through nginx or another reverse proxy in production.
    if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? "")) throw new NotFoundException();
    return this.metrics.metrics();
  }
}
