import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const [manifestPath, artifactPath, statePath] = process.argv.slice(2);
if (!manifestPath || !artifactPath || !statePath) throw new Error("manifest, artifact, and state paths are required");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("invalid release manifest");
const manifestKeys = ["formatVersion", "version", "commitSha", "builtAt", "artifact", "artifactSha256", "platform", "runtime", "compatibility"];
if (Object.keys(manifest).some((key) => !manifestKeys.includes(key)) || manifestKeys.some((key) => !(key in manifest))) throw new Error("invalid release manifest fields");
if (manifest.formatVersion !== 1 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error("unsupported release manifest");
if (!/^[a-f0-9]{7,64}$/.test(manifest.commitSha) || !/^[a-f0-9]{64}$/.test(manifest.artifactSha256) || !Number.isFinite(Date.parse(manifest.builtAt))) throw new Error("invalid release provenance");
if (manifest.runtime?.name !== "node" || manifest.runtime.major !== 22 || manifest.compatibility?.deviceProtocol !== "v1") throw new Error("incompatible runtime or protocol");
if (manifest.platform?.os !== "linux" || !Array.isArray(manifest.platform.architectures) || manifest.platform.architectures.some((item) => !["x64", "arm64"].includes(item))) throw new Error("incompatible release platform");
if (manifest.artifact !== basename(artifactPath)) throw new Error("artifact name does not match manifest");
const digest = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
if (digest !== manifest.artifactSha256) throw new Error("artifact checksum does not match manifest");
const spoolRoot = join(statePath, "transfers");
let schemas = [];
try {
  for (const file of await readdir(spoolRoot)) {
    if (!file.endsWith(".json")) continue;
    const state = JSON.parse(await readFile(join(spoolRoot, file), "utf8"));
    if (state === null || typeof state !== "object" || Array.isArray(state) || !Number.isInteger(state.schemaVersion)) throw new Error(`unrecognized spool state: ${file}`);
    schemas.push(state.schemaVersion);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const minimumReadable = manifest.compatibility.minimumReadableSpoolSchema;
const maximumReadable = manifest.compatibility.spoolSchema;
if (!Number.isInteger(minimumReadable) || !Number.isInteger(maximumReadable)) throw new Error("manifest spool compatibility missing");
if (schemas.some((schema) => schema < minimumReadable || schema > maximumReadable)) throw new Error("installed spool schema is incompatible with this release");
process.stdout.write(`${manifest.version}\n`);
