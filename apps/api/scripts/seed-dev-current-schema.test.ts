import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const seedSource = await readFile(new URL("./seed-dev.ts", import.meta.url), "utf8");
const soarmSource = await readFile(new URL("./seed-dev-soarm100.ts", import.meta.url), "utf8");

describe("seed-dev current Project schema", () => {
  it("seeds published Projects with child Models, revisions, blobs, and revision files", () => {
    expect(seedSource).toMatch(/insert into projects/i);
    expect(seedSource).toMatch(/insert into models \(id, project_id, name, position, latest_revision_id, active_revision_id\)/i);
    expect(seedSource).toMatch(/insert into model_revisions/i);
    expect(seedSource).toMatch(/insert into storage_blobs/i);
    expect(seedSource).toMatch(/insert into model_revision_files/i);
    expect(seedSource).toMatch(/insert into project_revisions/i);
    expect(seedSource).toMatch(/insert into project_revision_models/i);
    expect(seedSource).not.toMatch(/insert into model_files/i);
  });

  it("stores the SO-ARM100 repository path on its Project", () => {
    expect(soarmSource).toMatch(/select repo_path from projects where id = \$1/i);
    expect(soarmSource).toMatch(/insert into projects \(id, owner_id, title, description, repo_path\)/i);
    expect(soarmSource).not.toMatch(/select repo_path from models where id = \$1/i);
    expect(soarmSource).not.toMatch(/insert into models \(id, owner_id/i);
  });
});
