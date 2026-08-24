import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { allowlistedRelayLogRecord, createRelayLogger } from "./relay-logger.ts";

describe("relay structured logging", () => {
  it("drops fields outside the safe allowlist", () => {
    const record = allowlistedRelayLogRecord({
      event: "relay_auth",
      gateway_id: "gateway-1",
      commandPayload: "secret-command",
      serviceToken: "secret-token",
    } as never);
    expect(record).toEqual({ event: "relay_auth", gateway_id: "gateway-1" });
  });

  it("redacts secrets even when the raw pino boundary is used", () => {
    let output = "";
    const destination = new Writable({ write: (chunk, _encoding, callback) => { output += chunk.toString(); callback(); } });
    const logger = createRelayLogger("relay-test", destination);
    logger.info({ serviceToken: "secret-token", headers: { "x-relay-service-token": "secret-header" } }, "safe message");

    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("secret-header");
    expect(output).toContain("[REDACTED]");
  });
});
