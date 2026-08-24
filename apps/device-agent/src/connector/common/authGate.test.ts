import { describe, expect, it } from "vitest";
import { authenticateWithGate } from "./authGate.ts";
import type { ConnectorVendor, OperatorConfirmGate, PrinterEndpoint } from "./connector.ts";
import type { ConnectorTokenStore } from "./tokenStore.ts";

const ENDPOINT: PrinterEndpoint = { host: "192.168.88.82" };
const VENDOR: ConnectorVendor = "snapmaker";

function fakeGate(response: { approved: boolean; token?: string }): OperatorConfirmGate & { calls: number } {
  return {
    calls: 0,
    async requestApproval() {
      (this as { calls: number }).calls += 1;
      return response;
    },
  };
}

function memoryStore(): ConnectorTokenStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    load: (vendor, host) => data.get(`${vendor}:${host}`),
    save: (vendor, host, token) => void data.set(`${vendor}:${host}`, token),
  };
}

describe("authenticateWithGate", () => {
  it("skips the gate and reuses a saved token", async () => {
    const gate = fakeGate({ approved: true, token: "should-not-be-used" });
    const store = memoryStore();
    store.save(VENDOR, ENDPOINT.host, "saved-token");

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      confirmGate: gate,
      reason: "token-required",
      message: "m",
      tokenStore: store,
    });

    expect(result).toEqual({ ok: true, token: "saved-token" });
    expect(gate.calls).toBe(0);
  });

  it("prefers an explicitly passed savedToken over the store", async () => {
    const gate = fakeGate({ approved: true });
    const store = memoryStore();
    store.save(VENDOR, ENDPOINT.host, "store-token");

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      savedToken: "input-token",
      confirmGate: gate,
      reason: "token-required",
      message: "m",
      tokenStore: store,
    });

    expect(result).toEqual({ ok: true, token: "input-token" });
    expect(gate.calls).toBe(0);
  });

  it("goes through the gate when there is no saved token, and persists the returned token", async () => {
    const gate = fakeGate({ approved: true, token: "fresh-token" });
    const store = memoryStore();

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      confirmGate: gate,
      reason: "token-required",
      message: "m",
      tokenStore: store,
    });

    expect(result).toEqual({ ok: true, token: "fresh-token" });
    expect(gate.calls).toBe(1);
    expect(store.data.get(`${VENDOR}:${ENDPOINT.host}`)).toBe("fresh-token");
  });

  it("returns ok:false when the operator denies or the gate times out", async () => {
    const gate = fakeGate({ approved: false });
    const store = memoryStore();

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      confirmGate: gate,
      reason: "confirm-on-printer",
      message: "m",
      tokenStore: store,
    });

    expect(result.ok).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it("forcePrompt bypasses a saved/stale token and re-asks the operator", async () => {
    const gate = fakeGate({ approved: true, token: "rotated-token" });
    const store = memoryStore();
    store.save(VENDOR, ENDPOINT.host, "stale-token");

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      confirmGate: gate,
      reason: "token-required",
      message: "m",
      tokenStore: store,
      forcePrompt: true,
    });

    expect(result).toEqual({ ok: true, token: "rotated-token" });
    expect(gate.calls).toBe(1);
    expect(store.data.get(`${VENDOR}:${ENDPOINT.host}`)).toBe("rotated-token");
  });

  it("succeeds without persisting when approved with no token (confirm-on-printer)", async () => {
    const gate = fakeGate({ approved: true });
    const store = memoryStore();

    const result = await authenticateWithGate({
      vendor: VENDOR,
      endpoint: ENDPOINT,
      confirmGate: gate,
      reason: "confirm-on-printer",
      message: "m",
      tokenStore: store,
    });

    expect(result).toEqual({ ok: true, token: undefined });
    expect(store.data.size).toBe(0);
  });
});
