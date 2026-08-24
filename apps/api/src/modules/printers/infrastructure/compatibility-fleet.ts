import { pool } from "../../../db/client.ts";
import type { ManufacturingMethod } from "../../models/public/index.ts";
import { catalogCompatibilityMachines } from "../../catalog/public/index.ts";

// Парк принтеров юзера для GET /models?compatibility=mine (MF-1961, models/list.ts) — читает
// те же строки/поля, что и GET /me/printers/:id/compat (profile/activation.ts), но батчем на
// весь парк сразу (не по одному принтеру за раз), чтобы фильтр каталога не был N+1 по моделям.
// compat/check.ts (compatCheck) здесь не вызывается — там нужен конкретный (принтер, модель)
// вход, а листингу нужен SQL-предикат "подходит хотя бы одному принтеру парка" по всем моделям
// разом; SQL-версия той же геометрии/AMS/технологии строится в list.ts из этих же полей.

// machines.kind (baseline.sql) → способ изготовления модели (manufacturing.ts). Обратное той же
// карты нет намеренно — один kind сопоставлен максимум одному method, но не наоборот (два вида
// ЧПУ-станка — один method='cnc').
const MACHINE_KIND_TO_METHOD: Partial<Record<string, ManufacturingMethod>> = {
  fdm_printer: "fdm",
  sla_printer: "sla",
  cnc_router: "cnc",
  cnc_lathe: "cnc",
  laser_cutter: "laser",
};

export interface FleetPrinter {
  id: string;
  buildVolumeMm: { x: number; y: number; z: number };
  /** user_printers.capabilities->>'ams' — true/false известны только для агент-подключённых
   * принтеров; null — данных нет (запись вручную/каталог без capabilities), permissive. */
  amsCapability: boolean | null;
  /** machines.kind, сведённый к укрупнённой технологии; null — принтер без привязки к
   * каталогу (printer_id), тоже permissive (не блокируем на незнании). */
  technology: ManufacturingMethod | null;
}

// Тот же огромный дефолт объёма, что и в /me/printers/:id/compat (activation.ts) — "неизвестно"
// не должно блокировать геометрию листинга сильнее, чем блокировало бы одиночную проверку.
const UNKNOWN_BUILD_VOLUME_MM = { x: 100000, y: 100000, z: 100000 };

export async function loadCompatFleet(userId: string): Promise<FleetPrinter[]> {
  const result = await pool.query<{
    id: string;
    build_volume: { x: number; y: number; z: number } | null;
    capabilities: Record<string, unknown> | null;
    printer_id: string | null;
  }>(`select id, printer_id, build_volume, capabilities from user_printers where user_id = $1`, [userId]);

  const machines = await catalogCompatibilityMachines(result.rows.flatMap((row) => (row.printer_id === null ? [] : [row.printer_id])));
  return result.rows.map((row) => {
    const machine = row.printer_id === null ? undefined : machines.get(row.printer_id);
    const specs = machine?.specs ?? {};
    const buildVolumeMm = row.build_volume ?? (specs.build_volume as { x: number; y: number; z: number } | undefined) ?? UNKNOWN_BUILD_VOLUME_MM;
    const amsRaw = row.capabilities?.ams;
    const amsCapability = typeof amsRaw === "boolean" ? amsRaw : null;
    const technology = machine ? (MACHINE_KIND_TO_METHOD[machine.kind] ?? null) : null;
    return { id: row.id, buildVolumeMm, amsCapability, technology };
  });
}
