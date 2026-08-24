import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenAPIObject } from "@nestjs/swagger";
import { normalizeOpenApiOperationTags, serializeOpenApiDocument, shouldWriteOpenApiContract, writeOpenApiContract } from "./setup-openapi.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("OpenAPI contract startup writer", () => {
  it("removes generated controller tags when an explicit domain tag exists", () => {
    const document = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/health": {
          get: {
            operationId: "HealthController_health",
            tags: ["Health", "runtime", "runtime"],
            responses: {},
          },
        },
        "/fallback": {
          get: {
            operationId: "FallbackController_get",
            tags: ["Fallback"],
            responses: {},
          },
        },
      },
    } as OpenAPIObject;

    normalizeOpenApiOperationTags(document);

    expect(document.paths["/health"]?.get?.tags).toEqual(["runtime"]);
    expect(document.paths["/fallback"]?.get?.tags).toEqual(["Fallback"]);
  });

  it("enables automatic updates only for local and development startup", () => {
    expect(shouldWriteOpenApiContract(undefined)).toBe(true);
    expect(shouldWriteOpenApiContract("development")).toBe(true);
    expect(shouldWriteOpenApiContract("test")).toBe(false);
    expect(shouldWriteOpenApiContract("production")).toBe(false);
  });

  it("creates parent directories and atomically writes the canonical serialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "portal-openapi-"));
    temporaryDirectories.push(directory);
    const contractPath = join(directory, "nested", "openapi.v1.json");
    const document = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {},
    } as OpenAPIObject;

    await writeOpenApiContract(document, contractPath);

    expect(await readFile(contractPath, "utf8")).toBe(serializeOpenApiDocument(document));
  });
});
