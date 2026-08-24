import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const schemaPath = `${directory}/schema.json`;
const outputPath = `${directory}/generated.ts`;

function typeName(name) {
  return name[0].toUpperCase() + name.slice(1);
}

function literal(value) {
  return JSON.stringify(value);
}

function renderType(schema) {
  if (schema.$ref !== undefined) return typeName(schema.$ref.split("/").at(-1));
  if (schema.const !== undefined) return literal(schema.const);
  if (schema.enum !== undefined) return schema.enum.map(literal).join(" | ");
  if (schema.oneOf !== undefined) return schema.oneOf.map(renderType).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map((type) => renderType({ ...schema, type })).join(" | ");

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `ReadonlyArray<${renderType(schema.items ?? {})}>`;
    case "object": {
      const properties = Object.entries(schema.properties ?? {});
      if (properties.length === 0 && schema.maxProperties === 0) return "Readonly<Record<string, never>>";
      if (properties.length === 0 && typeof schema.additionalProperties === "object") {
        return `Readonly<Record<string, ${renderType(schema.additionalProperties)}>>`;
      }
      const required = new Set(schema.required ?? []);
      const fields = properties.map(([name, property]) => `  readonly ${name}${required.has(name) ? "" : "?"}: ${renderType(property)};`);
      return `{\n${fields.join("\n")}\n}`;
    }
    default:
      return "unknown";
  }
}

export function generateTypes(schema) {
  const definitions = Object.entries(schema.$defs ?? {});
  const body = definitions.map(([name, definition]) => `export type ${typeName(name)} = ${renderType(definition)};`).join("\n\n");
  return `// Generated from schema.json by generate-types.mjs. DO NOT EDIT.\n\n${body}\n`;
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const generated = generateTypes(schema);

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== generated) {
    console.error("device-protocol/v1/generated.ts is stale; run pnpm --filter @portal/contracts device-protocol:generate");
    process.exit(1);
  }
} else {
  writeFileSync(outputPath, generated);
}
