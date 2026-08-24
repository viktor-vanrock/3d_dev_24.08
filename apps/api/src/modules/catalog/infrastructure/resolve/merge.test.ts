import { describe, expect, it } from "vitest";
import { mergeCandidateIntoMachine } from "./merge.ts";

const NOW = "2026-07-10T00:00:00.000Z";

describe("mergeCandidateIntoMachine", () => {
  it("fills in a field that was previously unset, with provenance", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { build_volume: { x: 220, y: 220, z: 250 } },
      existingProvenance: {},
      candidateSpecs: { kinematics: "corexy" },
      candidateSource: "sovol3d-store",
      candidateSourceUrl: "https://www.sovol3d.com/products/x",
      candidateConfidence: 0.8,
      now: NOW,
    });
    expect(result.specs.kinematics).toBe("corexy");
    expect(result.provenance.kinematics).toEqual({
      source: "sovol3d-store",
      source_url: "https://www.sovol3d.com/products/x",
      ts: NOW,
      confidence: 0.8,
    });
    expect(result.updatedFields).toEqual(["kinematics"]);
    expect(result.conflicts).toEqual([]);
  });

  it("is a no-op when the candidate agrees with the existing value", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { kinematics: "corexy" },
      existingProvenance: { kinematics: { source: "cura-definitions", source_url: null, ts: "2020-01-01", confidence: 0.7 } },
      candidateSpecs: { kinematics: "corexy" },
      candidateSource: "sovol3d-store",
      candidateSourceUrl: null,
      candidateConfidence: 0.9,
      now: NOW,
    });
    expect(result.specs.kinematics).toBe("corexy");
    expect(result.provenance.kinematics!.ts).toBe("2020-01-01"); // не тронуто
    expect(result.updatedFields).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("a higher-priority source (vendor) overwrites a lower-priority one (structural)", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { max_nozzle_temp_c: 260 },
      existingProvenance: { max_nozzle_temp_c: { source: "cura-definitions", source_url: null, ts: "2020-01-01", confidence: 0.7 } },
      candidateSpecs: { max_nozzle_temp_c: 300 },
      candidateSource: "sovol3d-store",
      candidateSourceUrl: "https://www.sovol3d.com/products/x",
      candidateConfidence: 0.5,
      now: NOW,
    });
    expect(result.specs.max_nozzle_temp_c).toBe(300);
    expect(result.provenance.max_nozzle_temp_c!.source).toBe("sovol3d-store");
    expect(result.updatedFields).toEqual(["max_nozzle_temp_c"]);
    expect(result.conflicts).toEqual([]);
  });

  it("a lower-priority source does NOT silently overwrite a higher-priority one — field stays, flagged as conflict", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { max_nozzle_temp_c: 300 },
      existingProvenance: { max_nozzle_temp_c: { source: "sovol3d-store", source_url: null, ts: "2020-01-01", confidence: 0.9 } },
      candidateSpecs: { max_nozzle_temp_c: 260 },
      candidateSource: "cura-definitions",
      candidateSourceUrl: null,
      candidateConfidence: 0.7,
      now: NOW,
    });
    expect(result.specs.max_nozzle_temp_c).toBe(300); // старое значение сохранено как было
    expect(result.provenance.max_nozzle_temp_c!.source).toBe("sovol3d-store");
    expect(result.updatedFields).toEqual([]);
    expect(result.conflicts).toEqual(["max_nozzle_temp_c"]);
  });

  it("an untracked existing value (no provenance) resists an equal-or-lower tier candidate", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { kinematics: "bedslinger" },
      existingProvenance: {},
      candidateSpecs: { kinematics: "corexy" },
      candidateSource: "cura-definitions", // structural — beats untracked
      candidateSourceUrl: null,
      candidateConfidence: 0.9,
      now: NOW,
    });
    expect(result.specs.kinematics).toBe("corexy");
    expect(result.conflicts).toEqual([]);

    const resisted = mergeCandidateIntoMachine({
      existingSpecs: { kinematics: "bedslinger" },
      existingProvenance: {},
      candidateSpecs: { kinematics: "corexy" },
      candidateSource: "some-catalog-aggregator", // catalog tier — does not beat untracked
      candidateSourceUrl: null,
      candidateConfidence: 1,
      now: NOW,
    });
    expect(resisted.specs.kinematics).toBe("bedslinger");
    expect(resisted.conflicts).toEqual(["kinematics"]);
  });

  it("partial merge: resolves what it can, flags only the disputed field", () => {
    const result = mergeCandidateIntoMachine({
      existingSpecs: { max_nozzle_temp_c: 300 },
      existingProvenance: { max_nozzle_temp_c: { source: "sovol3d-store", source_url: null, ts: "2020-01-01", confidence: 0.9 } },
      candidateSpecs: { max_nozzle_temp_c: 260, kinematics: "corexy" },
      candidateSource: "cura-definitions",
      candidateSourceUrl: null,
      candidateConfidence: 0.7,
      now: NOW,
    });
    expect(result.specs.kinematics).toBe("corexy");
    expect(result.specs.max_nozzle_temp_c).toBe(300);
    expect(result.updatedFields).toEqual(["kinematics"]);
    expect(result.conflicts).toEqual(["max_nozzle_temp_c"]);
  });
});
