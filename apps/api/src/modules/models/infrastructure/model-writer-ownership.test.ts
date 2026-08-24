import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_SRC = path.resolve(import.meta.dirname, "../../..");
const FOREIGN_WRITER_DIRS = ["modules/generations", "modules/imports"];
const MODEL_WRITE_RE = /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?(models|model_files|model_tags)\b/i;

function productionTsFiles(directory: string): string[] {
  const absolute = path.join(API_SRC, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const file = path.join(absolute, entry);
    if (statSync(file).isDirectory()) return productionTsFiles(path.join(directory, entry));
    return file.endsWith(".ts") && !file.endsWith(".test.ts") ? [file] : [];
  });
}

describe("models/model_files writer ownership", () => {
  it("keeps production SQL writes inside the models owner", () => {
    const violations = FOREIGN_WRITER_DIRS.flatMap(productionTsFiles).filter((file) => MODEL_WRITE_RE.test(readFileSync(file, "utf8")));
    expect(violations.map((file) => path.relative(API_SRC, file))).toEqual([]);
  });
});
