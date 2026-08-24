import { ConnectorConfigError, parseConnectorConfig } from "./config.ts";
import {
  createConnector,
  productionConnectorRegistry,
  type ConnectorComposition,
  type ConnectorRegistry,
} from "./registry.ts";

export const CONNECTOR_CONFIG_ENV = "DEVICE_CONNECTOR_CONFIG";

export function composeDeviceAgentConnector(
  rawConfig: string,
  registry: ConnectorRegistry = productionConnectorRegistry,
): ConnectorComposition<"moonraker"> {
  return createConnector(parseConnectorConfig(rawConfig), registry);
}

export function composeDeviceAgentConnectorFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  registry: ConnectorRegistry = productionConnectorRegistry,
): ConnectorComposition<"moonraker"> {
  const rawConfig = environment[CONNECTOR_CONFIG_ENV];
  if (rawConfig === undefined || rawConfig.trim() === "") {
    throw new ConnectorConfigError(`${CONNECTOR_CONFIG_ENV} is required`);
  }
  return composeDeviceAgentConnector(rawConfig, registry);
}
