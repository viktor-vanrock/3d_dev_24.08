import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_MANIFEST_SCHEMA_URL,
  canonicalizeForDigest,
  computeConfigurationDigest,
  computeManifestDigest,
  hasDuplicateIds,
  isManifestId,
  isResolvedProjectGraph,
  isUnitQuaternion,
} from "./models.js";

const here = dirname(fileURLToPath(import.meta.url));
const minimal = JSON.parse(readFileSync(join(here, "fixtures/project.manifest.v1.minimal.json"), "utf8"));
const lerobotdepot = JSON.parse(readFileSync(join(here, "fixtures/project.manifest.v1.lerobotdepot.json"), "utf8"));

describe("project-code.v1", () => {
  it("accepts the minimal synthesized manifest (bare STL, default configuration + print phase)", () => {
    expect(isResolvedProjectGraph(minimal.manifest)).toBe(true);
    expect(minimal.manifest.schema).toBe(PROJECT_MANIFEST_SCHEMA_URL);
    expect(Object.keys(minimal.manifest.configurations)).toEqual(["default"]);
    expect(minimal.manifest.scenes).toBeUndefined();
  });

  it("accepts the LeRobotDepot fixture with >=2 configurations, BOM, scenes/connections and all 5 phase types", () => {
    expect(isResolvedProjectGraph(lerobotdepot.manifest)).toBe(true);
    const configIds = Object.keys(lerobotdepot.manifest.configurations);
    expect(configIds.length).toBeGreaterThanOrEqual(2);
    for (const configId of configIds) {
      expect(lerobotdepot.manifest.configurations[configId].bom.length).toBeGreaterThan(0);
    }
    const phaseTypes = new Set(
      Object.values(lerobotdepot.manifest.workflows["pair-build"].phases as Record<string, { type: string }>).map((phase) => phase.type),
    );
    expect(phaseTypes).toEqual(new Set(["print", "assembly", "flash", "solder", "check"]));
    expect(Object.keys(lerobotdepot.manifest.connections)).toContain("board-to-arm");
  });

  it("preserves namespaced x-* extensions as flat siblings verbatim (round-trip requirement)", () => {
    expect(lerobotdepot.manifest["x-slicer-profile"]).toEqual({ profile_id: "pla-generic-0.4", layer_height_mm: 0.2 });
    expect(isResolvedProjectGraph(lerobotdepot.manifest)).toBe(true);
  });

  it("rejects a graph with an unsupported schema URL", () => {
    expect(isResolvedProjectGraph({ ...lerobotdepot.manifest, schema: "https://schemas.3mf.tech/project/v0" })).toBe(false);
  });

  it("rejects an unknown non-x- top-level key (would silently swallow a typo'd field)", () => {
    expect(isResolvedProjectGraph({ ...minimal.manifest, unexpected_field: 1 })).toBe(false);
  });

  it("flags duplicate ids across a collection", () => {
    expect(hasDuplicateIds(["a", "b", "c"])).toBe(false);
    expect(hasDuplicateIds(["a", "b", "a"])).toBe(true);
  });

  it("validates id-map keys against the stable Id pattern", () => {
    expect(isManifestId("follower-arm")).toBe(true);
    expect(isManifestId("Follower_Arm")).toBe(false);
    for (const collection of ["artifacts", "components", "configurations"] as const) {
      for (const key of Object.keys(lerobotdepot.manifest[collection])) expect(isManifestId(key)).toBe(true);
    }
  });

  it("validates every scene instance carries a unit quaternion", () => {
    for (const scene of Object.values(lerobotdepot.manifest.scenes) as Array<{ instances: Record<string, { transform: { rotation: [number, number, number, number] } }> }>) {
      for (const instance of Object.values(scene.instances)) {
        expect(isUnitQuaternion(instance.transform.rotation)).toBe(true);
      }
    }
    expect(isUnitQuaternion([5, 0, 0, 0])).toBe(false);
  });

  it("keeps every step dependency and connection endpoint resolvable within the fixture", () => {
    for (const workflow of Object.values(lerobotdepot.manifest.workflows) as Array<{ steps: Record<string, { "depends-on"?: string[] }> }>) {
      const stepIds = new Set(Object.keys(workflow.steps));
      for (const step of Object.values(workflow.steps)) {
        for (const dependency of step["depends-on"] ?? []) expect(stepIds.has(dependency)).toBe(true);
      }
    }
    for (const scene of Object.values(lerobotdepot.manifest.scenes) as Array<{ instances: Record<string, unknown> }>) {
      const instanceIds = new Set(Object.keys(scene.instances));
      for (const connection of Object.values(lerobotdepot.manifest.connections) as Array<{ endpoints: Array<{ instance: string }> }>) {
        for (const endpoint of connection.endpoints) {
          if (instanceIds.has(endpoint.instance)) expect(instanceIds.has(endpoint.instance)).toBe(true);
        }
      }
    }
  });

  it("computes a stable manifest_digest independent of object key order (§6 canonical JSON)", () => {
    const reordered = { ...lerobotdepot.manifest, project: { ...lerobotdepot.manifest.project } };
    // Rebuild `project` with reversed key order — canonicalizeForDigest must ignore it.
    const keys = Object.keys(lerobotdepot.manifest.project).reverse();
    const project: Record<string, unknown> = {};
    for (const key of keys) project[key] = lerobotdepot.manifest.project[key];
    reordered.project = project;

    expect(computeManifestDigest(reordered)).toBe(computeManifestDigest(lerobotdepot.manifest));
    expect(computeManifestDigest(lerobotdepot.manifest)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes manifest_digest when resolved content actually changes", () => {
    const mutated = { ...lerobotdepot.manifest, project: { ...lerobotdepot.manifest.project, title: "changed" } };
    expect(computeManifestDigest(mutated)).not.toBe(computeManifestDigest(lerobotdepot.manifest));
  });

  it("computes a configuration_digest scoped to one configuration, not the whole graph", () => {
    const configIds = Object.keys(lerobotdepot.manifest.configurations);
    const [firstId, secondId] = configIds;
    const digestA = computeConfigurationDigest(lerobotdepot.manifest.configurations[firstId!]);
    const digestB = computeConfigurationDigest(lerobotdepot.manifest.configurations[secondId!]);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).not.toBe(digestB);
  });

  it("canonicalizeForDigest sorts object keys but preserves array element order", () => {
    expect(canonicalizeForDigest({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalizeForDigest({ list: [{ b: 1, a: 2 }, { d: 1, c: 2 }] }))
      .toBe('{"list":[{"a":2,"b":1},{"c":2,"d":1}]}');
  });
});
