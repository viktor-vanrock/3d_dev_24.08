import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readJsonFile(directory: string, filename: string): Promise<unknown> {
  const path = join(directory, filename);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`cannot read ${path}: ${message}`);
  }
}

export async function readJsonArray(directory: string, filename: string): Promise<readonly unknown[]> {
  const value = await readJsonFile(directory, filename);
  if (!Array.isArray(value)) throw new Error(`${filename} must contain a JSON array`);
  const output: unknown[] = [];
  for (const item of value) output.push(item);
  return output;
}
