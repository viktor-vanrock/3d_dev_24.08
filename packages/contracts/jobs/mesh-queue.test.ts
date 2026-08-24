import { describe, expect, it } from "vitest";
import {
  MESH_CONVERSION_JOB_CONTRACT_VERSION,
  isMeshConversionV1QueueJob,
  type MeshConversionV1QueueJob,
} from "./mesh.js";

const job: MeshConversionV1QueueJob = {
  queue: MESH_CONVERSION_JOB_CONTRACT_VERSION,
  eventId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  modelId: "33333333-3333-4333-8333-333333333333",
  revisionId: "44444444-4444-4444-8444-444444444444",
  correlationId: "55555555-5555-4555-8555-555555555555",
};

describe("mesh-conversion.v1", () => {
  it("accepts the exact versioned immutable-revision job", () => {
    expect(isMeshConversionV1QueueJob(job)).toBe(true);
  });

  it("rejects unknown versions and fields", () => {
    expect(isMeshConversionV1QueueJob({ ...job, queue: "mesh-conversion.v2" })).toBe(false);
    expect(isMeshConversionV1QueueJob({ ...job, payload: {} })).toBe(false);
  });
});
