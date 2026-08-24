import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import invalidFixtures from "./fixtures/invalid.json" with { type: "json" };
import validFixtures from "./fixtures/valid.json" with { type: "json" };
import limits from "./limits.json" with { type: "json" };
import { parseGatewayToRelayFrame, parseRelayToGatewayFrame } from "./runtime.ts";

type Direction = "gateway_to_relay" | "relay_to_gateway";

function parse(direction: Direction, raw: string) {
  return direction === "gateway_to_relay" ? parseGatewayToRelayFrame(raw) : parseRelayToGatewayFrame(raw);
}

describe("device-protocol/v1 generated contract", () => {
  it("keeps generated TypeScript exactly synchronized with schema.json", () => {
    const script = fileURLToPath(new URL("./generate-types.mjs", import.meta.url));
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("keeps the device-agent v1 consumer free of handwritten frame declarations", () => {
    const consumer = fileURLToPath(new URL("../../../../apps/device-agent/src/relay/protocol-v1.ts", import.meta.url));
    const source = readFileSync(consumer, "utf8");
    expect(source).toContain('from "@portal/contracts/device-protocol/v1"');
    expect(source).not.toMatch(/\b(?:interface|type)\s+(?:Hello|Heartbeat|Command|File|Error)[A-Za-z]*/);
  });

  it("requires exact v1 negotiation and has no versionless or N-1 acceptance", () => {
    const baseHello = {
      type: "hello",
      nonce: "0123456789abcdef0123456789abcdef",
      agent_version: "1.0.0",
      capabilities: [],
    };
    expect(parseGatewayToRelayFrame(JSON.stringify(baseHello))).toEqual({ ok: false, error: "invalid_frame" });
    expect(parseGatewayToRelayFrame(JSON.stringify({ ...baseHello, protocol_version: "v0" }))).toEqual({ ok: false, error: "unsupported_version" });
    expect(parseGatewayToRelayFrame(JSON.stringify({ ...baseHello, protocol_version: "v2" }))).toEqual({ ok: false, error: "unsupported_version" });
    expect(parseGatewayToRelayFrame(JSON.stringify({ ...baseHello, protocol_version: "v1" }))).toEqual({ ok: true, frame: { ...baseHello, protocol_version: "v1" } });
  });

  it.each(validFixtures.cases)("accepts valid fixture $name", ({ direction, frame }) => {
    expect(parse(direction as Direction, JSON.stringify(frame))).toEqual({ ok: true, frame });
  });

  it.each(invalidFixtures.cases)("rejects invalid fixture $name with its stable error", (fixture) => {
    const raw = fixture.validation_stage === "transport_size"
      ? `${JSON.stringify(fixture.frame)}${" ".repeat(limits.max_text_frame_bytes)}`
      : JSON.stringify(fixture.frame);
    expect(parse(fixture.direction as Direction, raw)).toEqual({ ok: false, error: fixture.expected_error });
  });
});
