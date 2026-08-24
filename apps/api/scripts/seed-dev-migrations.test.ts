import { describe, expect, it } from "vitest";
import { runDevMigrations } from "./seed-dev-migrations.ts";

describe("миграции seed-dev", () => {
  it("запускает штатную db:migrate из каталога API", async () => {
    const calls: { command: string; args: string[]; cwd: string }[] = [];

    await runDevMigrations({ DATABASE_URL: "postgres://portal_dev@localhost/portal_dev" }, async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
    });

    expect(calls).toEqual([expect.objectContaining({ command: "pnpm", args: ["run", "db:migrate"] })]);
    expect(calls[0]?.cwd).toMatch(/apps\/api$/);
  });
});
