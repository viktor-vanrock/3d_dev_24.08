import { describe, expect, it } from "vitest";
import { ConnectorConfigError, parseConnectorConfig, validateConnectorConfig } from "./config.ts";

describe("ConnectorConfig", () => {
  it("validates and normalizes the generic Moonraker discriminator", () => {
    expect(parseConnectorConfig('{"type":"moonraker","httpUrl":"http://printer:7125/","apiKey":"secret"}')).toEqual({
      type: "moonraker",
      httpUrl: "http://printer:7125",
      apiKey: "secret",
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["unknown discriminator", '{"type":"snapmaker","httpUrl":"http://printer:7125"}'],
    ["unknown field", '{"type":"moonraker","httpUrl":"http://printer:7125","fallback":true}'],
    ["wrong URL protocol", '{"type":"moonraker","httpUrl":"ws://printer:7125"}'],
    ["embedded credentials", '{"type":"moonraker","httpUrl":"http://user:pass@printer:7125"}'],
    ["invalid apiKey", '{"type":"moonraker","httpUrl":"http://printer:7125","apiKey":42}'],
  ])("rejects %s without a fallback", (_case, raw) => {
    expect(() => parseConnectorConfig(raw)).toThrow(ConnectorConfigError);
  });

  it("validates unknown values before domain mapping", () => {
    expect(() => validateConnectorConfig(["moonraker"])).toThrow("expected an object");
  });
});

