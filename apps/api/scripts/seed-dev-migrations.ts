import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export type MigrationRunner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<void>;

async function defaultMigrationRunner(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  await execFileAsync(command, args, options);
}

export async function runDevMigrations(env: NodeJS.ProcessEnv = process.env, runner: MigrationRunner = defaultMigrationRunner): Promise<void> {
  await runner("pnpm", ["run", "db:migrate"], { cwd: API_DIR, env });
}
