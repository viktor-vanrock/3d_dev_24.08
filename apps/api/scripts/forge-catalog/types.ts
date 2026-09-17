export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = boolean | number | string | null | JsonObject | readonly JsonValue[];

export interface ForgeMachine {
  readonly schemaVersion: "forge.machine.v1";
  readonly slug: string;
  readonly vendor: { readonly slug: string; readonly name: string };
  readonly machine: {
    readonly kind: "fdm_printer" | "sla_printer" | "cnc_router" | "cnc_lathe" | "laser_cutter";
    readonly model: string;
    readonly aliases: readonly string[];
    readonly integration: "live" | "in_development" | "none";
    readonly source: "official" | "community";
    readonly verified: boolean;
    readonly status: "active" | "quarantined" | "archived";
  };
  readonly specs: JsonObject;
  readonly fieldProvenance: JsonObject;
  readonly conflicts: readonly JsonValue[];
}

export interface ForgeMaterial {
  readonly brand: string;
  readonly lineName: string | null;
  readonly family: string | null;
  readonly url: string;
  readonly fields: JsonObject;
  readonly evidence: JsonObject;
}

export interface ForgeNews {
  readonly publisher: string;
  readonly url: string;
  readonly title: string;
  readonly dek: string | null;
  readonly bodyMarkdown: string;
  readonly published: string | null;
  readonly images: readonly string[];
  readonly claims: readonly JsonValue[];
  readonly extractor: string;
  readonly verifier: string;
}

export interface SectionReport {
  readonly found: number;
  readonly accepted: number;
  readonly quarantined: number;
  readonly rejected: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly warnings: readonly string[];
  readonly details?: Readonly<Record<string, Readonly<{ found: number; matched: number; quarantined: number }>>>;
}

export interface ForgeCatalogReport {
  readonly schemaVersion: "forge-catalog-import-report.v1";
  readonly sourceDirectory: string;
  readonly mode: "dry-run" | "apply";
  readonly generatedAt: string;
  readonly sections: Readonly<Record<string, SectionReport>>;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function jsonObject(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const output: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isJsonValue(child)) return null;
    output[key] = child;
  }
  return output;
}

export function jsonArray(value: unknown): readonly JsonValue[] | null {
  return Array.isArray(value) && value.every(isJsonValue) ? value : null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isObject(value)) return false;
  return Object.values(value).every(isJsonValue);
}
