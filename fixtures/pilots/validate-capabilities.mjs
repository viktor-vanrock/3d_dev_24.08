import { readFileSync } from "node:fs";
const { records } = JSON.parse(readFileSync(new URL("./printer-capability-fixtures.json", import.meta.url), "utf8"));
const errors = [];
const support = new Set(["list", "managed", "custom"]);
const connectors = new Set(["moonraker", "bambu-mqtt", "prusa-link", "octoprint", "vendor-cloud", "none"]);
for (const [index, record] of records.entries()) {
  const path = `records[${index}]`;
  if (!record.id || !record.model) errors.push(`${path}: identity is required`);
  if (!support.has(record.support_level)) errors.push(`${path}: invalid support_level`);
  if (record.connector_type !== null && !connectors.has(record.connector_type)) errors.push(`${path}: invalid connector_type`);
  if (!Array.isArray(record.capability)) errors.push(`${path}: capability must be an array`);
  if (!record.provenance?.source || !record.provenance?.source_url || !record.provenance?.confidence) errors.push(`${path}: provenance is incomplete`);
  if (record.status === "announced" && (record.support_level !== "list" || record.connector_type !== null || record.capability.length)) errors.push(`${path}: announced records must remain unconnected list fixtures`);
  if (record.connector_type === "moonraker" && !record.capability.includes("moonraker")) errors.push(`${path}: moonraker capability is missing`);
}
if (records.length !== 3) errors.push(`expected 3 records, got ${records.length}`);
if (errors.length) throw new Error(errors.join("\n"));
console.log(`Validated ${records.length} printer capability fixtures.`);
