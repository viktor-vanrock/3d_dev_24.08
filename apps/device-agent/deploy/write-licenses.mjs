import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("license output path is required");
const packages = [
  ["jose", new URL("../node_modules/jose/package.json", import.meta.url)],
  ["ws", new URL("../node_modules/ws/package.json", import.meta.url)],
  ["ajv", new URL("../../../packages/contracts/node_modules/ajv/package.json", import.meta.url)],
];
const notices = [];
for (const [, packagePath] of packages) {
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  notices.push(`${metadata.name}@${metadata.version}: ${metadata.license ?? "license metadata unavailable"}`);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${notices.sort().join("\n")}\n`, { mode: 0o644 });
