export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATERIAL_KINDS = new Set(["filament", "resin", "plywood", "aluminum"]);
const RELEASE_STATUSES = new Set(["announced", "preorder", "shipping", "eol"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const RELEASE_EVENT_DATE_SQL = "coalesce(re.ship_at, re.announced_at, '9999-12-31'::date)";

export function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseCatalogLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 24;
  return Math.min(Math.floor(value), 100);
}

export function parseCatalogOffset(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function parseMachineLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 24;
  return Math.min(Math.floor(value), 60);
}

export function parseMaterialKind(raw: unknown): string | null {
  return typeof raw === "string" && MATERIAL_KINDS.has(raw) ? raw : null;
}

export function parseReleaseLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 24;
  return Math.min(Math.floor(value), 60);
}

export function parseReleaseStatuses(raw: unknown): readonly string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const statuses = new Set<string>();
  for (const value of values) if (typeof value === "string" && RELEASE_STATUSES.has(value)) statuses.add(value);
  return [...statuses];
}

export function parseReleaseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_RE.test(raw)) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

export function encodeReleaseCursor(values: readonly [string, string]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

export function decodeReleaseCursor(raw: unknown): readonly [string, string] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const date: unknown = parsed[0];
    const id: unknown = parsed[1];
    if (typeof date !== "string" || Number.isNaN(Date.parse(date))) return null;
    if (typeof id !== "string" || !UUID_RE.test(id)) return null;
    return [date, id];
  } catch {
    return null;
  }
}

export function percentage(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}
