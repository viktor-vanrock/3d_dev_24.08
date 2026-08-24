import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { ModelOwnerRepository } from "./model-owner.repository.ts";
import type { ModelQueryExecutor } from "../public/index.ts";

describe("ModelOwnerRepository caller transaction seam", () => {
  it("uses the supplied executor for generation draft creation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "model-id" }], rowCount: 1 });
    const repository = new ModelOwnerRepository({ query: vi.fn() } as unknown as Pool);
    await expect(
      repository.createGenerationDraft({ query } as ModelQueryExecutor, {
        ownerId: "owner-id",
        title: "Draft",
        sourceFormat: "stl",
        sourceGenerationId: "generation-id",
      }),
    ).resolves.toBe("model-id");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0]).toContain("insert into projects");
    expect(query.mock.calls[0]![0]).toContain("insert into models");
  });

  it("uses the supplied executor for imported model updates", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new ModelOwnerRepository({ query: vi.fn() } as unknown as Pool);
    await repository.updateImportedModel({ query } as ModelQueryExecutor, {
      modelId: "model-id",
      title: "Imported",
      description: null,
      sourceFormat: "zip",
    });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0]).toContain("update projects");
    expect(query.mock.calls[0]![0]).toContain("update model_revisions");
  });
});
