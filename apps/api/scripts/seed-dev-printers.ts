import type { Pool } from "pg";
import type { FirmwarePilotStatus } from "@portal/contracts/http/devices";

export interface DevPrinterSeed {
  slug: string;
  brand: string;
  model: string;
  sources: string[];
  pilot_status: FirmwarePilotStatus;
}

/**
 * Публичные карточки пилотных моделей для dev-каталога.
 * Значения синхронизированы с каноническим срезом firmware-pilot.v1; freshness
 * пересчитывается API от updated_at при каждом чтении.
 */
export const DEV_PRINTERS: readonly DevPrinterSeed[] = [
  {
    slug: "creality.ender-3-v3-ke",
    brand: "Creality",
    model: "Ender-3 V3 KE",
    sources: ["https://www.creality.com/products/ender-3-v3-ke"],
    pilot_status: {
      status: "reported",
      stage: "not_started",
      updated_at: "2026-07-12T00:00:00Z",
      freshness: "stale",
      source: "fleet",
      confidence: "limited",
    },
  },
  {
    slug: "flsun.v400",
    brand: "FLSun",
    model: "V400",
    sources: ["https://flsun3d.com/products/flsun-v400"],
    pilot_status: {
      status: "reported",
      stage: "not_started",
      updated_at: "2026-07-11T00:00:00Z",
      freshness: "stale",
      source: "fleet",
      confidence: "limited",
    },
  },
];

/** Идемпотентно публикует минимальные карточки, не затирая Fleet-факт. */
export async function upsertDevPrinters(db: Pool): Promise<void> {
  for (const printer of DEV_PRINTERS) {
    await db.query(
      `insert into printers (
         slug, brand, model, status, type, sources, field_provenance,
         confidence, filled_by, gaps, verified, pilot_status
       ) values ($1, $2, $3, 'announced', 'fdm', $4, '{}'::jsonb, 'low', 'seed-dev', $5, false, $6)
       on conflict (slug) do update set
         brand = excluded.brand,
         model = excluded.model,
         status = excluded.status,
         type = excluded.type,
         sources = excluded.sources,
         confidence = excluded.confidence,
         filled_by = excluded.filled_by,
         gaps = excluded.gaps,
         verified = excluded.verified,
         pilot_status = coalesce(printers.pilot_status, excluded.pilot_status),
         updated_at = now()`,
      [printer.slug, printer.brand, printer.model, printer.sources, ["pilot_status"], printer.pilot_status],
    );
  }
}
