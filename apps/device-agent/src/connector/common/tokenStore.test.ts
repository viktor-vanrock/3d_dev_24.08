import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileConnectorTokenStore } from "./tokenStore.ts";

describe("FileConnectorTokenStore", () => {
  let dir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "connector-tokens-"));
    originalHome = process.env.MULTICA_AGENT_HOME;
    process.env.MULTICA_AGENT_HOME = dir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.MULTICA_AGENT_HOME;
    else process.env.MULTICA_AGENT_HOME = originalHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when nothing was ever saved", () => {
    const store = new FileConnectorTokenStore();
    expect(store.load("snapmaker", "192.168.88.82")).toBeUndefined();
  });

  it("round-trips a saved token for the same vendor+host", () => {
    const store = new FileConnectorTokenStore();
    store.save("snapmaker", "192.168.88.82", "tok-abc");
    expect(store.load("snapmaker", "192.168.88.82")).toBe("tok-abc");
  });

  it("keeps tokens separate per vendor and per host", () => {
    const store = new FileConnectorTokenStore();
    store.save("snapmaker", "192.168.88.82", "snap-tok");
    store.save("creality", "192.168.88.82", "creality-tok");
    store.save("snapmaker", "192.168.88.90", "snap-tok-2");

    expect(store.load("snapmaker", "192.168.88.82")).toBe("snap-tok");
    expect(store.load("creality", "192.168.88.82")).toBe("creality-tok");
    expect(store.load("snapmaker", "192.168.88.90")).toBe("snap-tok-2");
  });

  it("overwrites a stale token on re-save and survives a fresh store instance", () => {
    new FileConnectorTokenStore().save("snapmaker", "192.168.88.82", "old");
    new FileConnectorTokenStore().save("snapmaker", "192.168.88.82", "new");
    expect(new FileConnectorTokenStore().load("snapmaker", "192.168.88.82")).toBe("new");
  });
});
