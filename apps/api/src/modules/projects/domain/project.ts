import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PROJECT_CONTRACT_VERSION = "project-api.v1" as const;
export const PROJECT_SOURCE_FORMATS = ["stl", "obj", "3mf", "step", "dxf", "svg", "gcode", "gerber", "zip"] as const;
export const PROJECT_CRAFTS = ["3d_printing", "cnc", "electronics", "software"] as const;
export const PROJECT_MANUFACTURING_METHODS = ["fdm", "sla", "cnc", "laser"] as const;
export const PROJECT_REVISION_STATUSES = ["uploaded", "pending", "processing", "ready", "failed"] as const;
export const PROJECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export type ProjectSourceFormat = (typeof PROJECT_SOURCE_FORMATS)[number];
export type ProjectCraft = (typeof PROJECT_CRAFTS)[number];
export type ProjectManufacturingMethod = (typeof PROJECT_MANUFACTURING_METHODS)[number];
export type ProjectRevisionStatus = (typeof PROJECT_REVISION_STATUSES)[number];

export interface ProjectMetadataInput {
  readonly title: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
  readonly repo_url?: string | null;
}

export interface ProjectPatchInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly tags?: readonly string[];
  readonly repo_url?: string | null;
}

export interface ProjectUpload {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

export interface ModelCreateInput {
  readonly name: string;
  readonly manufacturing_method?: ProjectManufacturingMethod;
  readonly requires_ams?: boolean;
}

export interface CursorPage {
  readonly limit?: number;
  readonly cursor?: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value)).digest();
}

function cursorSecret(): string {
  return process.env.PROJECT_CURSOR_SECRET || process.env.JWT_SECRET || "project-api-v1-local-cursor";
}

export function encodeCursor(parts: readonly unknown[]): string {
  const payload = Buffer.from(canonicalJson({ v: 1, parts })).toString("base64url");
  const signature = createHmac("sha256", cursorSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeCursor(raw: string | undefined, expectedParts: number): readonly unknown[] | null {
  if (raw === undefined) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", cursorSecret()).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; parts?: unknown };
    return decoded.v === 1 && Array.isArray(decoded.parts) && decoded.parts.length === expectedParts ? decoded.parts : null;
  } catch {
    return null;
  }
}

export function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return [];
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))].sort();
}
