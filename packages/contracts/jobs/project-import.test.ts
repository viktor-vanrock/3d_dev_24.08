import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_IMPORT_CONTRACT_VERSION, isProjectImportPayload } from "./project-import.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/project-import.v1.json"), "utf8"));

describe("project-import.v1", () => {
  it.each(["git_lerobotdepot", "stl_batch", "multipart_3mf", "failed_quarantine_rejected"] as const)(
    "accepts the %s payload shape",
    (scenario) => {
      expect(isProjectImportPayload(fixture[scenario].payload)).toBe(true);
      expect(fixture[scenario].payload.contract_version).toBe(PROJECT_IMPORT_CONTRACT_VERSION);
    },
  );

  it("resolves an external commit sha only for git sources", () => {
    expect(fixture.git_lerobotdepot.result.external_commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.stl_batch.result.external_commit_sha).toBeNull();
    expect(fixture.multipart_3mf.result.external_commit_sha).toBeNull();
  });

  it("never drops last-known-good on failure", () => {
    expect(fixture.failed_quarantine_rejected.result.status).toBe("failed");
    expect(fixture.failed_quarantine_rejected.result.resolved_commit_sha).toBeNull();
    expect(fixture.failed_quarantine_rejected.result.items).toHaveLength(0);
    expect(fixture.failed_quarantine_rejected.result.last_known_good_preserved).toBe(true);
  });

  it("marks bare STL/3MF imports as manifest_present=false (synthesized manifest)", () => {
    expect(fixture.stl_batch.result.manifest_present).toBe(false);
    expect(fixture.multipart_3mf.result.manifest_present).toBe(false);
    expect(fixture.git_lerobotdepot.result.manifest_present).toBe(true);
  });

  it("gives every STL batch file its own item result (independent processing status)", () => {
    expect(fixture.stl_batch.payload.source.upload_refs).toHaveLength(1);
    expect(fixture.stl_batch.result.items).toHaveLength(fixture.stl_batch.payload.source.upload_refs.length);
    expect(fixture.stl_batch.result.items[0].artifact_id).toBe("benchy-stl");
  });

  it("rejects a payload with an unknown contract_version", () => {
    expect(isProjectImportPayload({ ...fixture.stl_batch.payload, contract_version: "project-import.v0" })).toBe(false);
  });

  it("rejects a payload missing idempotency_key", () => {
    const { idempotency_key: _removed, ...incomplete } = fixture.stl_batch.payload;
    expect(isProjectImportPayload(incomplete)).toBe(false);
  });

  it("rejects an empty stl upload_refs batch", () => {
    expect(
      isProjectImportPayload({
        ...fixture.stl_batch.payload,
        source: { kind: "stl", upload_refs: [] },
      }),
    ).toBe(false);
  });
});
