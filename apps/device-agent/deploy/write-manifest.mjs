import { writeFile } from "node:fs/promises";

const output = process.argv[2];
if (!output) throw new Error("manifest output path is required");
const required = ["RELEASE_VERSION", "RELEASE_COMMIT_SHA", "RELEASE_ARTIFACT", "RELEASE_SHA256"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);

const manifest = {
  formatVersion: 1,
  version: process.env.RELEASE_VERSION,
  commitSha: process.env.RELEASE_COMMIT_SHA.toLowerCase(),
  builtAt: new Date().toISOString(),
  artifact: process.env.RELEASE_ARTIFACT,
  artifactSha256: process.env.RELEASE_SHA256,
  platform: { os: "linux", architectures: ["x64", "arm64"] },
  runtime: { name: "node", major: 22 },
  compatibility: { deviceProtocol: "v1", spoolSchema: 1, minimumReadableSpoolSchema: 1 },
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

