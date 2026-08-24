import { readFile } from "node:fs/promises";

process.env.NODE_ENV ??= "test";
process.env.JWT_SECRET ??= "openapi-contract-generation-only";

const [{ createNestApp }, { createOpenApiDocument, OPENAPI_CONTRACT_PATH, serializeOpenApiDocument, writeOpenApiContract }] = await Promise.all([
  import("../src/nest/bootstrap.ts"),
  import("../src/nest/openapi/setup-openapi.ts"),
]);

const check = process.argv.includes("--check");
const app = await createNestApp();

try {
  await app.init();
  const document = createOpenApiDocument(app);
  const serialized = serializeOpenApiDocument(document);
  if (check) {
    const committed = await readFile(OPENAPI_CONTRACT_PATH, "utf8").catch(() => "");
    if (committed !== serialized) {
      throw new Error("OpenAPI contract is stale. Run `pnpm --filter @portal/api openapi:generate`.");
    }
  } else {
    await writeOpenApiContract(document);
  }
} finally {
  await app.close();
}
