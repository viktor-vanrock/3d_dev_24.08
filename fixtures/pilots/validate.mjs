import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(directory, "pilot-passport.schema.json"), "utf8"));
const passports = readdirSync(directory)
  .filter((file) => file.endsWith(".json") && file !== "pilot-passport.schema.json")
  .filter((file) => file !== "printer-capability-fixtures.json")
  .map((file) => [file, JSON.parse(readFileSync(join(directory, file), "utf8"))]);

const errors = [];

function resolve(node) {
  if (!node.$ref) return node;
  const path = node.$ref.replace("#/", "").split("/");
  return path.reduce((value, key) => value[key], schema);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validate(value, rawNode, path, result) {
  const node = resolve(rawNode);
  if (node.const !== undefined && value !== node.const) result.push(`${path}: expected ${JSON.stringify(node.const)}`);
  if (node.enum && !node.enum.includes(value)) result.push(`${path}: value is not in enum`);
  if (node.type && typeOf(value) !== node.type) {
    result.push(`${path}: expected ${node.type}, got ${typeOf(value)}`);
    return;
  }
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) result.push(`${path}: less than minimum`);
    if (node.maximum !== undefined && value > node.maximum) result.push(`${path}: greater than maximum`);
  }
  if (typeof value === "string") {
    if (node.minLength && value.length < node.minLength) result.push(`${path}: shorter than minLength`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) result.push(`${path}: does not match pattern`);
  }
  if (Array.isArray(value)) {
    if (node.minItems && value.length < node.minItems) result.push(`${path}: fewer than minItems`);
    if (node.items) value.forEach((item, index) => validate(item, node.items, `${path}[${index}]`, result));
  }
  if (typeOf(value) === "object") {
    for (const key of node.required ?? []) if (!(key in value)) result.push(`${path}: missing ${key}`);
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (node.properties ?? {}))) result.push(`${path}: unknown ${key}`);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) if (key in value) validate(value[key], child, `${path}.${key}`, result);
  }
}

for (const [file, passport] of passports) {
  validate(passport, schema, file, errors);
  if (JSON.stringify(passport).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|api[_-]?key|enroll/i)) errors.push(`${file}: contains a forbidden address or secret-like field`);
}
if (passports.length !== 2) errors.push(`expected exactly two pilot passports, got ${passports.length}`);
if (errors.length) throw new Error(errors.join("\n"));
console.log(`Validated ${passports.length} pilot passports against ${schema.title}.`);
