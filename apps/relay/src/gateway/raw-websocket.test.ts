import { describe, expect, it } from "vitest";
import { createRawWebSocketServer } from "./raw-websocket.ts";

describe("raw WebSocket runtime", () => {
  it("uses raw ws with no implicit listener and bounded payloads", () => {
    const server = createRawWebSocketServer(131_072);
    expect(server.options.noServer).toBe(true);
    expect(server.options.maxPayload).toBe(131_072);
    expect(server.options.perMessageDeflate).toBe(false);
    server.close();
  });
});
