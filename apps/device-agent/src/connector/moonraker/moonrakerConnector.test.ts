import { describe, expect, it, vi } from "vitest";
import type { PrinterDriver } from "../../driver/printerDriver.ts";
import { createMoonrakerConnector } from "./moonrakerConnector.ts";

describe("generic Moonraker connector lifecycle", () => {
  it("returns only the PrinterDriver port and lifecycle handles", async () => {
    const driver = {
      firmwareClass: "klipper",
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => Promise.resolve()),
    } as Pick<PrinterDriver, "firmwareClass" | "connect" | "disconnect"> as PrinterDriver;
    const createDriver = vi.fn(() => driver);

    const connector = createMoonrakerConnector(
      { type: "moonraker", httpUrl: "http://printer:7125", apiKey: "secret" },
      { createDriver },
    );
    await connector.lifecycle.connect();
    await connector.lifecycle.disconnect();

    expect(createDriver).toHaveBeenCalledWith({ httpUrl: "http://printer:7125", apiKey: "secret" });
    expect(connector.driver).toBe(driver);
    expect(driver.connect).toHaveBeenCalledOnce();
    expect(driver.disconnect).toHaveBeenCalledOnce();
  });
});
