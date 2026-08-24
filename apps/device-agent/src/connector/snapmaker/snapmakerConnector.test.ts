import { afterEach, describe, expect, it } from "vitest";
import type { OperatorConfirmGate, PrinterEndpoint } from "../common/connector.ts";
import type { ConnectorTokenStore } from "../common/tokenStore.ts";
import { startFakeMoonraker, type FakeMoonraker } from "../../testing/fakeMoonraker.ts";
import {
  HttpMoonrakerIdentityProbe,
  MdnsPermissionDeniedError,
  SnapmakerConnector,
  type MdnsBrowser,
  type MdnsCandidate,
} from "./snapmakerConnector.ts";

function endpointOf(fake: FakeMoonraker): Required<PrinterEndpoint> {
  const url = new URL(fake.url);
  return { host: url.hostname, port: Number(url.port) };
}

function memoryStore(): ConnectorTokenStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    load: (vendor, host) => data.get(`${vendor}:${host}`),
    save: (vendor, host, token) => void data.set(`${vendor}:${host}`, token),
  };
}

function fakeGate(responses: Array<{ approved: boolean; token?: string }>): OperatorConfirmGate & { calls: number } {
  let i = 0;
  return {
    calls: 0,
    async requestApproval() {
      (this as { calls: number }).calls += 1;
      const response = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return response!;
    },
  };
}

function fixedMdnsBrowser(candidates: MdnsCandidate[]): MdnsBrowser {
  return { async browse() { return candidates; } };
}

function throwingMdnsBrowser(err: Error): MdnsBrowser {
  return { async browse() { throw err; } };
}

describe("SnapmakerConnector", () => {
  let fake: FakeMoonraker | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  describe("discover", () => {
    it("manual IP fallback: probes the given host directly and returns it when it looks like Moonraker", async () => {
      fake = await startFakeMoonraker({ hostname: "snapmaker-u1" });
      const endpoint = endpointOf(fake);
      const connector = new SnapmakerConnector();

      const results = await connector.discover(`${endpoint.host}:${endpoint.port}`);

      expect(results).toEqual([
        { endpoint: { host: endpoint.host, port: endpoint.port }, vendor: "snapmaker", model: "snapmaker-u1", raw: expect.any(Object) },
      ]);
    });

    it("manual IP fallback: returns empty when the host doesn't respond as Moonraker (wrong device)", async () => {
      fake = await startFakeMoonraker({ respondToIdentity: false });
      const endpoint = endpointOf(fake);
      const connector = new SnapmakerConnector();

      const results = await connector.discover(`${endpoint.host}:${endpoint.port}`);
      expect(results).toEqual([]);
    });

    it("mDNS: filters browse candidates down to hosts that pass the Moonraker identity check", async () => {
      fake = await startFakeMoonraker({ hostname: "snapmaker-u1" });
      const endpoint = endpointOf(fake);
      const mdnsBrowser = fixedMdnsBrowser([
        { host: endpoint.host, port: endpoint.port, raw: { source: "mdns" } },
        { host: "192.0.2.99", port: 7125, raw: { source: "mdns" } }, // unreachable, filtered out
      ]);
      const connector = new SnapmakerConnector({ mdnsBrowser, identifyTimeoutMs: 300 });

      const results = await connector.discover();

      expect(results).toEqual([
        { endpoint: { host: endpoint.host, port: endpoint.port }, vendor: "snapmaker", model: "snapmaker-u1", raw: expect.any(Object) },
      ]);
    });

    it("mDNS: propagates MdnsPermissionDeniedError distinctly from a clean 'no devices' scan", async () => {
      const connector = new SnapmakerConnector({ mdnsBrowser: throwingMdnsBrowser(new MdnsPermissionDeniedError("EPERM")) });
      await expect(connector.discover()).rejects.toBeInstanceOf(MdnsPermissionDeniedError);
    });

    it("mDNS: no candidates found resolves to an empty array, not an error", async () => {
      const connector = new SnapmakerConnector({ mdnsBrowser: fixedMdnsBrowser([]) });
      await expect(connector.discover()).resolves.toEqual([]);
    });
  });

  describe("identity timeout", () => {
    it("times out the identity probe instead of hanging, and reports it as no device found", async () => {
      const neverRespondingFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as unknown as typeof fetch;
      const probe = new HttpMoonrakerIdentityProbe(neverRespondingFetch);
      const result = await probe.identify({ host: "192.0.2.50" }, 20);
      expect(result).toEqual({ ok: false, model: null, raw: {} });
    });
  });

  describe("connect", () => {
    it("rejects a wrong device before ever prompting the operator", async () => {
      fake = await startFakeMoonraker({ respondToIdentity: false });
      const endpoint = endpointOf(fake);
      const gate = fakeGate([{ approved: true }]);
      const connector = new SnapmakerConnector();

      const result = await connector.connect({ endpoint, confirmGate: gate });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/wrong device/);
      expect(gate.calls).toBe(0);
    });

    it("auth: goes through the operator gate when there's no saved token and connects", async () => {
      fake = await startFakeMoonraker({ apiKey: "printer-secret", hostname: "snapmaker-u1" });
      const endpoint = endpointOf(fake);
      const gate = fakeGate([{ approved: true, token: "printer-secret" }]);
      const store = memoryStore();
      const connector = new SnapmakerConnector({ tokenStore: store });

      const result = await connector.connect({ endpoint, confirmGate: gate });

      expect(result.ok).toBe(true);
      expect(result.driver).toBeDefined();
      expect(gate.calls).toBe(1);
      expect(store.data.get(`snapmaker:${endpoint.host}`)).toBe("printer-secret");
      await connector.disconnect();
    });

    it("auth: operator denial surfaces as ok:false without touching the printer", async () => {
      fake = await startFakeMoonraker({ apiKey: "printer-secret" });
      const endpoint = endpointOf(fake);
      const gate = fakeGate([{ approved: false }]);
      const connector = new SnapmakerConnector({ tokenStore: memoryStore() });

      const result = await connector.connect({ endpoint, confirmGate: gate });

      expect(result).toEqual({ ok: false, error: expect.any(String) });
      expect(gate.calls).toBe(1);
    });

    it("auth: reuses a saved token and never re-prompts the operator", async () => {
      fake = await startFakeMoonraker({ apiKey: "printer-secret", hostname: "snapmaker-u1" });
      const endpoint = endpointOf(fake);
      const gate = fakeGate([{ approved: false }]); // would fail the flow if ever called
      const connector = new SnapmakerConnector();

      const result = await connector.connect({ endpoint, confirmGate: gate, savedToken: "printer-secret" });

      expect(result.ok).toBe(true);
      expect(gate.calls).toBe(0);
      await connector.disconnect();
    });

    it("revoke: a stale saved token is rejected by the printer, connector forces one re-prompt and recovers", async () => {
      fake = await startFakeMoonraker({ apiKey: "printer-secret", hostname: "snapmaker-u1" });
      const endpoint = endpointOf(fake);
      // Оператор ротировал/отозвал токен на принтере — старый локально сохранённый токен
      // больше не тот, что реально требует Moonraker; коннектор обязан заметить провал
      // driver.connect() и один раз форсированно переспросить оператора, а не тихо застрять.
      const gate = fakeGate([{ approved: true, token: "printer-secret" }]);
      const store = memoryStore();
      store.save("snapmaker", endpoint.host, "stale-revoked-token");
      const connector = new SnapmakerConnector({ tokenStore: store });

      const result = await connector.connect({ endpoint, confirmGate: gate, savedToken: "stale-revoked-token" });

      expect(result.ok).toBe(true);
      expect(gate.calls).toBe(1);
      expect(store.data.get(`snapmaker:${endpoint.host}`)).toBe("printer-secret");
      await connector.disconnect();
    });

    it("revoke: if the operator also declines the forced re-prompt, connect fails cleanly", async () => {
      fake = await startFakeMoonraker({ apiKey: "printer-secret" });
      const endpoint = endpointOf(fake);
      const gate = fakeGate([{ approved: false }]);
      const store = memoryStore();
      store.save("snapmaker", endpoint.host, "stale-revoked-token");
      const connector = new SnapmakerConnector({ tokenStore: store });

      const result = await connector.connect({ endpoint, confirmGate: gate, savedToken: "stale-revoked-token" });

      expect(result.ok).toBe(false);
      expect(gate.calls).toBe(1);
    });
  });

  describe("disconnect", () => {
    it("is a no-op when never connected", async () => {
      const connector = new SnapmakerConnector();
      await expect(connector.disconnect()).resolves.toBeUndefined();
    });
  });
});
