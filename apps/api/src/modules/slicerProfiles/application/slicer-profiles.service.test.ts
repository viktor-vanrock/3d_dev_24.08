import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { SlicerProfileLookupPort } from "../public/index.ts";
import { SlicerProfilesService } from "./slicer-profiles.service.ts";
import { MachineId, MaterialId, SlicerProfileId, type ProfileClass } from "../domain/slicer-profile.ts";
import { InMemorySlicerProfileRateLimitAdapter } from "../infrastructure/in-memory-rate-limit.adapter.ts";
import { MeshSlicerProfileAdapter } from "../infrastructure/mesh-slicer-profile.adapter.ts";
import { SlicerProfilesRepository } from "../infrastructure/slicer-profiles.repository.ts";

class FakeLookup implements SlicerProfileLookupPort {
  listActive(_profileClass: ProfileClass) {
    return Promise.resolve([
      { id: "prusa", name: "Any Prusa", source_name: "PrusaSlicer", machine_id: null, material_id: null, slicer: "prusaslicer" as const },
      { id: "orca-hidden", name: "Generic Orca", source_name: "OrcaSlicer", machine_id: null, material_id: null, slicer: "orcaslicer" as const },
      { id: "orca-u1", name: "Snapmaker U1 (0.4 nozzle)", source_name: "OrcaSlicer", machine_id: null, material_id: null, slicer: "orcaslicer" as const },
    ]);
  }

  recommendationInputs() {
    return Promise.resolve({
      printer: {
        id: "printer",
        nozzleDiameterMm: 0.4,
        kinematics: "corexy",
        buildVolumeMm: { x: 256, y: 256, z: 256 },
        maxNozzleTempC: 300,
        maxBedTempC: 110,
        maxPrintSpeedMmS: 500,
      },
      filament: { id: "filament", materialClass: "pla", diameterMm: 1.75 },
      profiles: [
        {
          id: "base",
          profileClass: "process" as const,
          slicer: "orcaslicer" as const,
          name: "Base",
          machineId: "printer",
          materialId: null,
          inheritsId: null,
          params: { kinematics: "corexy", nozzle_diameter_mm: 0.4 },
          sourceName: "OrcaSlicer",
          sourceUrl: null,
          sourceRef: "test",
          license: "AGPL-3.0-or-later",
          confidence: 1,
          extrapolatedFromId: null,
        },
      ],
    });
  }

  profileExists() {
    return Promise.resolve(true);
  }
  activeProfileName() {
    return Promise.resolve("Profile");
  }
  compatibilityFilament() {
    return Promise.resolve(null);
  }
  machineExists() {
    return Promise.resolve(true);
  }
  filamentExists() {
    return Promise.resolve(true);
  }
  modelExists() {
    return Promise.resolve(true);
  }
  makeOwnedBy(_makeId: string, _userId: UserId) {
    return Promise.resolve(true);
  }
}

const pool = new Pool();
const limiter = new InMemorySlicerProfileRateLimitAdapter();
const service = new SlicerProfilesService(new FakeLookup(), limiter, new SlicerProfilesRepository(pool), new MeshSlicerProfileAdapter());
const identity = { userId: "user", ip: "127.0.0.1", userAgent: "vitest", acceptLanguage: "ru", acceptEncoding: "gzip" };

describe("SlicerProfilesService", () => {
  afterEach(() => limiter.reset());
  afterAll(async () => pool.end());

  it("keeps all Prusa profiles and only the mesh-resolvable Orca whitelist", async () => {
    await expect(service.list("machine")).resolves.toEqual({
      profiles: [
        { id: "prusa", name: "Any Prusa", source_name: "PrusaSlicer", machine_id: null, material_id: null },
        { id: "orca-u1", name: "Snapmaker U1 (0.4 nozzle)", source_name: "OrcaSlicer", machine_id: null, material_id: null },
      ],
    });
  });

  it("serializes the legacy recommendation v1 response", async () => {
    const result = await service.recommend("user" as UserId, identity, MachineId("printer"), MaterialId("filament"), "appearance");
    expect(result).toMatchObject({
      limited: false,
      value: {
        contract_version: "slicer.profile-recommendation.v1",
        printer_id: "printer",
        filament_id: "filament",
        intent: "appearance",
      },
    });
  });

  it("threads the mesh adapter through the public port", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ ini: "[print]", params: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    try {
      await expect(service.resolvePrusaIni(SlicerProfileId("profile"))).resolves.toEqual({ ok: true, ini: "[print]", params: {} });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
