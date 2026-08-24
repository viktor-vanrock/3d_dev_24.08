import { describe, expect, it } from "vitest";
import { validateDispatch } from "./index.js";

const base = {
  accountId: "account-1",
  sliceJobId: "slice-1",
  profileHash: "profile-a",
  configFingerprint: "config-a",
  nozzleFingerprint: "nozzle-a",
  target: { accountId: "account-1", profileHash: "profile-a", configFingerprint: "config-a", nozzleFingerprint: "nozzle-a", online: true, cancelled: false },
};

describe("validateDispatch", () => {
  it("accepts an exact target match and preserves the trace", () => {
    expect(validateDispatch(base)).toEqual({ ok: true, sliceJobId: "slice-1" });
  });

  it.each([
    ["account", { accountId: "account-2" }, "ACCOUNT_MISMATCH"],
    ["profile", { profileHash: "profile-b" }, "PROFILE_MISMATCH"],
    ["config", { configFingerprint: "config-b" }, "CONFIG_MISMATCH"],
    ["nozzle", { nozzleFingerprint: "nozzle-b" }, "CAPABILITY_MISMATCH"],
  ])("rejects a changed %s", (_name, change, code) => {
    const result = validateDispatch({ ...base, target: { ...base.target, ...change } });
    expect(result).toEqual({ ok: false, code, sliceJobId: "slice-1" });
  });

  it("rejects an offline or cancelled target before creating a device job", () => {
    expect(validateDispatch({ ...base, target: { ...base.target, online: false } })).toMatchObject({ ok: false, code: "TARGET_OFFLINE" });
    expect(validateDispatch({ ...base, target: { ...base.target, cancelled: true } })).toMatchObject({ ok: false, code: "CANCELLED" });
  });
});
