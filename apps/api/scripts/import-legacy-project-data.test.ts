import { describe, expect, it } from "vitest";
import { fingerprintSchemaLines, stableUuid } from "./import-legacy-project-data.ts";

describe("legacy Project importer primitives", () => {
  it("generates deterministic, namespaced v5 UUIDs without preserving legacy IDs", () => {
    const legacy = "11111111-1111-4111-8111-111111111111";
    const first = stableUuid("dump-a", "project", legacy);
    expect(first).toBe(stableUuid("dump-a", "project", legacy));
    expect(first).not.toBe(legacy);
    expect(first).not.toBe(stableUuid("dump-a", "model", legacy));
    expect(first).not.toBe(stableUuid("dump-b", "project", legacy));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("fingerprints canonical schema lines including their order and terminal newline", () => {
    expect(fingerprintSchemaLines(["models.id:uuid:NO", "models.title:text:NO"])).toBe("5b3d1ebccbf4fc9e46d90cb57a3d1ac8245441bbbd92ae81305ee56b4ab6f183");
    expect(fingerprintSchemaLines(["models.title:text:NO", "models.id:uuid:NO"])).not.toBe(fingerprintSchemaLines(["models.id:uuid:NO", "models.title:text:NO"]));
  });
});
