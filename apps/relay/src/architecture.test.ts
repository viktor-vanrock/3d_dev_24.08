import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("relay package boundaries", () => {
  it("is an independent Nest raw-WebSocket package without a database client", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string>; scripts: Record<string, string> };
    expect(packageJson.dependencies).toHaveProperty("@nestjs/core");
    expect(packageJson.dependencies).toHaveProperty("ws");
    expect(packageJson.dependencies).toHaveProperty("@portal/contracts");
    expect(packageJson.dependencies).not.toHaveProperty("pg");
    expect(packageJson.dependencies).not.toHaveProperty("prisma");
    expect(packageJson.dependencies).not.toHaveProperty("redis");
    for (const script of ["build", "start", "typecheck", "lint", "test"]) expect(packageJson.scripts).toHaveProperty(script);
  });
});
