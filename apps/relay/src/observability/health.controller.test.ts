import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.ts";
import { RuntimeState } from "./runtime-state.service.ts";

describe("HealthController", () => {
  it("separates liveness from readiness", () => {
    const state = new RuntimeState();
    const controller = new HealthController(state);
    expect(controller.health()).toEqual({ status: "up" });
    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);

    state.onApplicationBootstrap();
    expect(controller.readiness()).toEqual({ status: "ready" });

    state.onApplicationShutdown();
    expect(controller.health()).toEqual({ status: "up" });
    expect(() => controller.readiness()).toThrow(ServiceUnavailableException);
  });
});
