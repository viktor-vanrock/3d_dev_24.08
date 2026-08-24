import { MoonrakerDriver, type MoonrakerDriverConfig } from "../../driver/moonraker/moonrakerDriver.ts";
import type { PrinterDriver } from "../../driver/printerDriver.ts";
import type { MoonrakerConnectorConfig } from "../config.ts";
import type { ConnectorComposition } from "../registry.ts";

export interface MoonrakerConnectorDependencies {
  readonly createDriver?: (config: MoonrakerDriverConfig) => PrinterDriver;
}

export function createMoonrakerConnector(
  config: MoonrakerConnectorConfig,
  dependencies: MoonrakerConnectorDependencies = {},
): ConnectorComposition<"moonraker"> {
  const driver = (dependencies.createDriver ?? ((driverConfig) => new MoonrakerDriver(driverConfig)))({
    httpUrl: config.httpUrl,
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
  });

  return {
    type: "moonraker",
    driver,
    lifecycle: {
      connect: () => driver.connect(),
      disconnect: () => driver.disconnect(),
    },
  };
}
