import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGatewayToRelayFrame, parseRelayToGatewayFrame } from "@portal/contracts/device-protocol/v1";

interface ValidFixture {
  readonly direction: "gateway_to_relay" | "relay_to_gateway";
  readonly frame: object;
}

interface InvalidFixture extends ValidFixture {
  readonly expected_error: string;
  readonly validation_stage?: string;
}

function readFixtures<T>(fileName: string): readonly T[] {
  const path = new URL(`../../../packages/contracts/device-protocol/v1/fixtures/${fileName}`, import.meta.url);
  return (JSON.parse(readFileSync(path, "utf8")) as { readonly cases: readonly T[] }).cases;
}

function parse(direction: ValidFixture["direction"], raw: string) {
  return direction === "gateway_to_relay" ? parseGatewayToRelayFrame(raw) : parseRelayToGatewayFrame(raw);
}

describe("relay canonical device-protocol fixtures", () => {
  it("accepts every shared valid frame through the exact relay runtime validators", () => {
    for (const fixture of readFixtures<ValidFixture>("valid.json")) {
      expect(parse(fixture.direction, JSON.stringify(fixture.frame))).toEqual({ ok: true, frame: fixture.frame });
    }
  });

  it("rejects every shared invalid frame with its stable error", () => {
    const limitsPath = new URL("../../../packages/contracts/device-protocol/v1/limits.json", import.meta.url);
    const limits = JSON.parse(readFileSync(limitsPath, "utf8")) as { readonly max_text_frame_bytes: number };
    for (const fixture of readFixtures<InvalidFixture>("invalid.json")) {
      const encoded = JSON.stringify(fixture.frame);
      const raw = fixture.validation_stage === "transport_size"
        ? `${encoded}${" ".repeat(limits.max_text_frame_bytes)}`
        : encoded;
      expect(parse(fixture.direction, raw)).toEqual({ ok: false, error: fixture.expected_error });
    }
  });
});
