import { createHmac, timingSafeEqual } from "node:crypto";

export const PRINTER_CATALOG_CURSOR_TTL_SECONDS = 15 * 60;
const DEV_CURSOR_SECRET = "development-only-printer-catalog-cursor-secret";

export type PrinterCatalogCursorValue = string | number | boolean | null;

export interface EncodePrinterCatalogCursorOptions {
  fingerprint: string;
  position: readonly PrinterCatalogCursorValue[];
  secret?: string;
  now?: number;
  ttlSeconds?: number;
}

export interface DecodePrinterCatalogCursorOptions {
  fingerprint: string;
  secret?: string;
  now?: number;
}

export interface DecodedPrinterCatalogCursor {
  position: PrinterCatalogCursorValue[];
  expiresAt: number;
}

export class CatalogCursorError extends Error {
  readonly code = "invalid_cursor" as const;

  constructor() {
    super("invalid cursor");
    this.name = "CatalogCursorError";
  }
}

function secretFor(secret?: string): string {
  const configured = secret ?? process.env.PRINTER_CATALOG_CURSOR_SECRET ?? process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new CatalogCursorError();
  return DEV_CURSOR_SECRET;
}

function nowSeconds(value?: number): number {
  return value ?? Math.floor(Date.now() / 1000);
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new CatalogCursorError();
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function isCursorValue(value: unknown): value is PrinterCatalogCursorValue {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

export function encodePrinterCatalogCursor(options: EncodePrinterCatalogCursorOptions): string {
  if (!options.fingerprint || !Array.isArray(options.position) || !options.position.every(isCursorValue)) throw new CatalogCursorError();
  const issuedAt = nowSeconds(options.now);
  const ttl = options.ttlSeconds ?? PRINTER_CATALOG_CURSOR_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new CatalogCursorError();
  const payload = JSON.stringify({
    v: 1,
    exp: issuedAt + ttl,
    fingerprint: options.fingerprint,
    position: options.position,
  });
  const body = encode(payload);
  return `c1.${body}.${signature(body, secretFor(options.secret))}`;
}

export function decodePrinterCatalogCursor(raw: unknown, options: DecodePrinterCatalogCursorOptions): DecodedPrinterCatalogCursor {
  if (typeof raw !== "string" || !raw) throw new CatalogCursorError();
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "c1") throw new CatalogCursorError();

  const [, body, suppliedSignature] = parts;
  if (!body || !suppliedSignature) throw new CatalogCursorError();
  const expectedSignature = signature(body, secretFor(options.secret));
  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  const suppliedText = Buffer.from(suppliedSignature, "ascii");
  const expectedText = Buffer.from(expectedSignature, "ascii");
  if (supplied.length !== expected.length || suppliedText.length !== expectedText.length || !timingSafeEqual(suppliedText, expectedText)) {
    throw new CatalogCursorError();
  }

  try {
    const parsed = JSON.parse(decode(body)) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { v?: unknown }).v !== 1 ||
      typeof (parsed as { exp?: unknown }).exp !== "number" ||
      typeof (parsed as { fingerprint?: unknown }).fingerprint !== "string" ||
      !Array.isArray((parsed as { position?: unknown }).position) ||
      !(parsed as { position: unknown[] }).position.every(isCursorValue)
    )
      throw new CatalogCursorError();

    const payload = parsed as { exp: number; fingerprint: string; position: PrinterCatalogCursorValue[] };
    if (payload.fingerprint !== options.fingerprint || payload.exp <= nowSeconds(options.now)) throw new CatalogCursorError();
    return { position: payload.position, expiresAt: payload.exp };
  } catch (error) {
    if (error instanceof CatalogCursorError) throw error;
    throw new CatalogCursorError();
  }
}
