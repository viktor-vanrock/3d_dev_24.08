import type { PrinterDriver } from "../driver/printerDriver.ts";
import {
  PRODUCTION_CONNECTOR_TYPES,
  type ConnectorConfig,
  type MoonrakerConnectorConfig,
  type ProductionConnectorType,
} from "./config.ts";
import { createMoonrakerConnector } from "./moonraker/moonrakerConnector.ts";

export interface ConnectorLifecycle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ConnectorComposition<Type extends ProductionConnectorType> {
  readonly type: Type;
  readonly driver: PrinterDriver;
  readonly lifecycle: ConnectorLifecycle;
}

export interface ConnectorRegistry {
  readonly moonraker: (config: MoonrakerConnectorConfig) => ConnectorComposition<"moonraker">;
}

export const productionConnectorRegistry: ConnectorRegistry = {
  moonraker: createMoonrakerConnector,
};

export const productionConnectorModules = [
  { type: "moonraker", module: "./moonraker/moonrakerConnector.ts" },
] as const satisfies ReadonlyArray<{ type: ProductionConnectorType; module: string }>;

export function createConnector(
  config: ConnectorConfig,
  registry: ConnectorRegistry = productionConnectorRegistry,
): ConnectorComposition<ConnectorConfig["type"]> {
  return registry.moonraker(config);
}

export function productionConnectorTypes(): readonly ProductionConnectorType[] {
  return PRODUCTION_CONNECTOR_TYPES;
}
