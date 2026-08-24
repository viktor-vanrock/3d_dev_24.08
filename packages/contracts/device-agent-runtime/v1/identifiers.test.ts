import { describe, expect, expectTypeOf, it } from "vitest";
import { CommandId, DeviceId, GatewayId, TransferId, type GatewayId as GatewayIdType } from "./index.ts";

function gatewayOnly(value: GatewayIdType): string {
  return value;
}

describe("device-agent runtime domain identifiers", () => {
  it("validates identifier syntax before applying a brand", () => {
    expect(GatewayId("gateway-1")).toBe("gateway-1");
    expect(DeviceId("device-1")).toBe("device-1");
    expect(CommandId("command-1")).toBe("command-1");
    expect(TransferId("transfer-1")).toBe("transfer-1");
    expect(GatewayId("bad gateway")).toBeNull();
  });

  it("keeps gateway, device, command and transfer identifiers nominally distinct", () => {
    const gateway = GatewayId("gateway-1");
    const device = DeviceId("device-1");
    expect(gateway).not.toBeNull();
    expect(device).not.toBeNull();
    if (gateway === null || device === null) throw new Error("validated identifiers expected");

    expectTypeOf(gateway).toMatchTypeOf<GatewayIdType>();
    expect(gatewayOnly(gateway)).toBe("gateway-1");
    // @ts-expect-error DeviceId must not cross a GatewayId domain boundary.
    gatewayOnly(device);
  });
});
