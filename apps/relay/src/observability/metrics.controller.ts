import { Controller, Get, Header, Inject } from "@nestjs/common";
import { RelayMetrics } from "./metrics.service.ts";

@Controller()
export class MetricsController {
  constructor(@Inject(RelayMetrics) private readonly metrics: RelayMetrics) {}

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @Header("cache-control", "no-store")
  render(): string {
    return this.metrics.render();
  }
}
