import { Controller, Get, Header, Inject, ServiceUnavailableException } from "@nestjs/common";
import { RuntimeState } from "./runtime-state.service.ts";

@Controller()
export class HealthController {
  constructor(@Inject(RuntimeState) private readonly runtimeState: RuntimeState) {}

  @Get("health")
  @Header("cache-control", "no-store")
  health(): { readonly status: "up" } {
    return { status: "up" };
  }

  @Get("ready")
  @Header("cache-control", "no-store")
  readiness(): { readonly status: "ready" } {
    const state = this.runtimeState.snapshot();
    if (!state.ready) {
      throw new ServiceUnavailableException({ status: "not_ready", reason: state.reason ?? "unknown" });
    }
    return { status: "ready" };
  }
}
