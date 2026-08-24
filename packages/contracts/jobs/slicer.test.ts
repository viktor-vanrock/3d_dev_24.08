import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SliceTrustContractError,
  buildSliceTrustMaterial,
  canonicalizeStockConfig,
  createConfigFingerprint,
  serializeSliceTrustMaterial,
} from "./slicer.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/slice-trust.v1.json"), "utf8"));

describe("slice-trust.v1", () => {
  it("produces the fixture fingerprint from the normalized stock input", () => {
    const canonical = canonicalizeStockConfig(fixture.stock_agent.stock_input);
    expect(canonical).toBe(fixture.stock_agent.canonical_json);
    const expected = createHash("sha256").update(fixture.stock_agent.canonical_json, "utf8").digest("hex");
    expect(fixture.stock_agent.fingerprint).toBe(expected);
    expect(createConfigFingerprint(fixture.stock_agent.stock_input)).toBe(expected);
  });

  it("keeps the canonical fingerprint when object fields are reordered", () => {
    const input = fixture.stock_agent.stock_input;
    const reordered = {
      stock_profile_id: input.stock_profile_id,
      printer_model_id: input.printer_model_id,
      firmware_revision: input.firmware_revision,
      kinematics: input.kinematics,
      build_volume_mm: { y: input.build_volume_mm.y, z: input.build_volume_mm.z, x: input.build_volume_mm.x },
      nozzle_diameter_um: input.nozzle_diameter_um,
      firmware_family: input.firmware_family,
    };
    expect(createConfigFingerprint(reordered)).toBe(createConfigFingerprint(input));
  });

  it("rejects a stock input with a missing required field", () => {
    const { firmware_revision: _removed, ...incomplete } = fixture.stock_agent.stock_input;
    expect(() => canonicalizeStockConfig(incomplete)).toThrow(SliceTrustContractError);
  });

  it.each(["custom", "mismatch"] as const)("does not issue a canonical fingerprint for %s configuration", (state) => {
    const material = buildSliceTrustMaterial({
      ...fixture.slice_material,
      fingerprint_source: "agent",
      fingerprint_state: state,
      config_fingerprint: "a".repeat(64),
      fingerprint_algorithm_version: "agent-config.v1",
    });
    expect(material.canonical_config_fingerprint).toBeNull();
    expect(material.global_dedup_eligible).toBe(false);
  });

  it("keeps declared stock account-scoped even when its fingerprint is canonical", () => {
    const material = buildSliceTrustMaterial({
      ...fixture.slice_material,
      fingerprint_source: "declared",
      fingerprint_state: "stock",
      stock_input: fixture.stock_agent.stock_input,
    });
    expect(material.config_fingerprint).toBe(createConfigFingerprint(fixture.stock_agent.stock_input));
    expect(material.canonical_config_fingerprint).toBe(material.config_fingerprint);
    expect(material.global_dedup_eligible).toBe(false);
  });

  it("rejects a declared custom configuration because it has no agent fact", () => {
    expect(() => buildSliceTrustMaterial({
      ...fixture.slice_material,
      fingerprint_source: "declared",
      fingerprint_state: "custom",
      config_fingerprint: "a".repeat(64),
      fingerprint_algorithm_version: "agent-config.v1",
    })).toThrow(SliceTrustContractError);
  });

  it("serializes the version, slice key and fingerprint together for signing", () => {
    const material = buildSliceTrustMaterial({
      ...fixture.slice_material,
      fingerprint_source: "agent",
      fingerprint_state: "stock",
      stock_input: fixture.stock_agent.stock_input,
    });
    const signingInput = serializeSliceTrustMaterial(material);
    expect(signingInput).toContain('"contract_version":"slice-trust.v1"');
    expect(signingInput).toContain(`"slice_key":"${fixture.slice_material.slice_key}"`);
    expect(signingInput).toContain(`"config_fingerprint":"${material.config_fingerprint}"`);
    expect(() => serializeSliceTrustMaterial({ ...material, contract_version: "slice-trust.v0" } as unknown as typeof material)).toThrow(
      SliceTrustContractError,
    );
  });
});
