import { describe, expect, it } from "vitest";
import { buildDeviceSliceTrustMaterial, SliceTrustApiError, type SliceTrustDeviceContext, type SliceTrustRequest } from "./sliceTrust.ts";

const stockInput = {
  printer_model_id: " ENDER-3-V3-KE ",
  stock_profile_id: " CREALITY/ENDER-3-V3-KE/0.4 ",
  nozzle_diameter_um: 400,
  build_volume_mm: { z: 240, x: 220, y: 220 },
  kinematics: " Cartesian ",
  firmware_family: " Klipper ",
  firmware_revision: "v0.12.0",
};

const device: SliceTrustDeviceContext = {
  accountId: "account-a",
  deviceId: "device-a",
  agentId: "agent-a",
  persistedConfigFingerprint: null,
};

const baseRequest: SliceTrustRequest = {
  contract_version: "slice-trust.v1",
  profile_id: "profile-a",
  slice_key: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  fingerprint_source: "declared",
  fingerprint_state: "stock",
  stock_input: stockInput,
};

describe("Gateway slice-trust producer", () => {
  it("builds account-scoped declared stock material without persisting raw config", () => {
    const material = buildDeviceSliceTrustMaterial(baseRequest, device, { authenticatedAgentId: null });

    expect(material).toMatchObject({
      contract_version: "slice-trust.v1",
      account_id: "account-a",
      device_id: "device-a",
      profile_id: "profile-a",
      fingerprint_source: "declared",
      fingerprint_state: "stock",
      fingerprint_algorithm_version: "config-fingerprint.v1",
      canonical_config_fingerprint: "b4f62fa5e32a92358fcac6f0f922f15140892ffa156742b63a97471d0efcc63b",
      cross_account_reuse: false,
      global_dedup_eligible: false,
    });
    expect(material).not.toHaveProperty("stock_input");
  });

  it("accepts a custom fingerprint only from the device's authenticated agent", () => {
    const material = buildDeviceSliceTrustMaterial(
      {
        ...baseRequest,
        fingerprint_source: "agent",
        fingerprint_state: "custom",
        stock_input: undefined,
        config_fingerprint: "a".repeat(64),
        fingerprint_algorithm_version: "agent-config.v1",
      },
      device,
      { authenticatedAgentId: "agent-a" },
    );

    expect(material).toMatchObject({
      fingerprint_source: "agent",
      fingerprint_state: "custom",
      fingerprint_algorithm_version: "agent-config.v1",
      config_fingerprint: "a".repeat(64),
      canonical_config_fingerprint: null,
    });
  });

  it.each([
    ["missing agent authentication", { authenticatedAgentId: null }],
    ["wrong agent", { authenticatedAgentId: "agent-b" }],
  ])("rejects custom material with %s", (_name, auth) => {
    expect(() =>
      buildDeviceSliceTrustMaterial(
        {
          ...baseRequest,
          fingerprint_source: "agent",
          fingerprint_state: "mismatch",
          stock_input: undefined,
          config_fingerprint: "b".repeat(64),
          fingerprint_algorithm_version: "agent-config.v1",
        },
        device,
        auth,
      ),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_INVALID"));
  });

  it("rejects an authenticated agent when the device has no agent binding", () => {
    expect(() =>
      buildDeviceSliceTrustMaterial(
        {
          ...baseRequest,
          fingerprint_source: "agent",
          fingerprint_state: "custom",
          stock_input: undefined,
          config_fingerprint: "f".repeat(64),
          fingerprint_algorithm_version: "agent-config.v1",
        },
        {
          ...device,
          agentId: null,
        },
        { authenticatedAgentId: "agent-a" },
      ),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_INVALID"));
  });

  it("does not treat a persisted fingerprint as an agent credential", () => {
    expect(() =>
      buildDeviceSliceTrustMaterial(
        {
          ...baseRequest,
          fingerprint_source: "agent",
          fingerprint_state: "custom",
          stock_input: undefined,
          config_fingerprint: "f".repeat(64),
          fingerprint_algorithm_version: "agent-config.v1",
        },
        {
          ...device,
          persistedConfigFingerprint: "f".repeat(64),
        },
        { authenticatedAgentId: null },
      ),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_INVALID"));
  });

  it("rejects a legacy or unknown contract version instead of falling back", () => {
    expect(() =>
      buildDeviceSliceTrustMaterial({ ...baseRequest, contract_version: "slice-trust.v0" }, device, {
        authenticatedAgentId: null,
      }),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_VERSION_UNSUPPORTED"));
  });

  it.each(["custom", "mismatch"] as const)("rejects declared %s state as invalid trust evidence", (fingerprintState) => {
    expect(() =>
      buildDeviceSliceTrustMaterial(
        {
          ...baseRequest,
          fingerprint_state: fingerprintState,
          config_fingerprint: "c".repeat(64),
          stock_input: undefined,
          fingerprint_algorithm_version: "agent-config.v1",
        },
        device,
        { authenticatedAgentId: null },
      ),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_INVALID"));
  });

  it("detects a changed agent fact as a conflict and never overwrites it", () => {
    expect(() =>
      buildDeviceSliceTrustMaterial(
        {
          ...baseRequest,
          fingerprint_source: "agent",
          fingerprint_state: "custom",
          stock_input: undefined,
          config_fingerprint: "d".repeat(64),
          fingerprint_algorithm_version: "agent-config.v1",
        },
        {
          ...device,
          persistedConfigFingerprint: "e".repeat(64),
        },
        { authenticatedAgentId: "agent-a" },
      ),
    ).toThrowError(new SliceTrustApiError("SLICE_TRUST_CONFLICT"));
  });
});
