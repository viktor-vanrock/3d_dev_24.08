import { describe, expect, it, vi } from "vitest";
import type { PrinterDriver } from "../driver/printerDriver.ts";
import { composeDeviceAgentConnector, composeDeviceAgentConnectorFromEnvironment } from "./composition.ts";
import { productionConnectorModules, productionConnectorTypes, type ConnectorRegistry } from "./registry.ts";

function fakeDriver(): PrinterDriver {
  return {
    firmwareClass: "test",
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    capabilities: vi.fn(() => Promise.reject(new Error("unused"))),
    status: vi.fn(() => Promise.reject(new Error("unused"))),
    pause: vi.fn(() => Promise.reject(new Error("unused"))),
    resume: vi.fn(() => Promise.reject(new Error("unused"))),
    cancel: vi.fn(() => Promise.reject(new Error("unused"))),
    uploadGcode: vi.fn(() => Promise.reject(new Error("unused"))),
    startPrint: vi.fn(() => Promise.reject(new Error("unused"))),
    camera: vi.fn(() => Promise.reject(new Error("unused"))),
    onStatusUpdate: vi.fn(() => () => undefined),
  };
}

describe("production connector registry", () => {
  it("selects exactly one typed factory after runtime validation", async () => {
    const driver = fakeDriver();
    const moonraker = vi.fn(() => ({
      type: "moonraker" as const,
      driver,
      lifecycle: { connect: () => driver.connect(), disconnect: () => driver.disconnect() },
    }));
    const registry: ConnectorRegistry = { moonraker };

    const composition = composeDeviceAgentConnector(
      '{"type":"moonraker","httpUrl":"http://printer:7125"}',
      registry,
    );
    await composition.lifecycle.connect();
    await composition.lifecycle.disconnect();

    expect(moonraker).toHaveBeenCalledOnce();
    expect(moonraker).toHaveBeenCalledWith({ type: "moonraker", httpUrl: "http://printer:7125" });
    expect(driver.connect).toHaveBeenCalledOnce();
    expect(driver.disconnect).toHaveBeenCalledOnce();
  });

  it("fails closed when environment config is absent", () => {
    expect(() => composeDeviceAgentConnectorFromEnvironment({})).toThrow("DEVICE_CONNECTOR_CONFIG is required");
  });

  it("keeps every production module reachable and excludes experimental Snapmaker", () => {
    expect(productionConnectorModules.map(({ type }) => type)).toEqual(productionConnectorTypes());
    expect(productionConnectorModules.some(({ module }) => module.includes("snapmaker"))).toBe(false);
  });
});

