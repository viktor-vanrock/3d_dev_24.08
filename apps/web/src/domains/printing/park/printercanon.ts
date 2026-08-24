import { isFirmwarePilotStatus, type FirmwarePilotStatus } from "@portal/contracts/http/devices";
import { supportLevelOf } from "../printers/labels.ts";
import type { SupportLevelKey } from "../printers/facets.ts";
import type { PrinterCanonInfo } from "./gating.ts";

// Мост между двумя каталогами (риск раздвоенного канона, docs/epics/printers.research.md §9.4):
// шаг 1 мастера выбирает станок из `machines` (MF-32/437, id/brand/model), а гейтинг §3.3 читает
// поля канона `printers` (MF-878/839, id=slug). Общего ключа между таблицами сегодня нет —
// сводить их предстоит Data (MF-405/406), это НЕ работа этой карточки. Здесь — единственный
// практичный мост без него: best-effort текстовый матч по бренду/модели поверх уже публичного
// `GET /printers` (printers.ts — без сессии), тот же приём точечного поиска, что
// fetchPopularMachines (home/catalog.ts) уже применяет для другого каталога.
//
// GET /printers пока НЕ отдаёт support_level/connector_type/firmware_ready/firmware_public в
// ответе (колонки есть в БД миграцией 20260710440000, сериализация — MF-884, ещё in_progress на
// момент MF-903) — читаем поля defensively (все опциональны), гейтинг сам честно деградирует в
// «данные ещё не собраны» (gating.ts). Как только Data досериализует ответ, матчинг здесь
// заработает без изменений.

import { apiFetch } from "@shared/api";

interface PrinterSearchRow {
  id?: string;
  slug?: string;
  brand?: string;
  model?: string;
  support_level?: string;
  connector_type?: string | null;
  firmware_ready?: boolean;
  firmware_public?: boolean;
  pilot_status?: unknown;
}

export interface PrinterCanonMatch extends PrinterCanonInfo {
  slug: string | null;
  supportLevel: SupportLevelKey | null;
  pilotStatus: FirmwarePilotStatus | undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function recordFromPrinterResponse(value: unknown): PrinterSearchRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  const printer = response.printer;
  if (printer && typeof printer === "object" && !Array.isArray(printer)) return printer as PrinterSearchRow;
  return response as PrinterSearchRow;
}

async function fetchPilotStatus(slug: string): Promise<FirmwarePilotStatus | undefined> {
  try {
    const response = await apiFetch(`/printers/${encodeURIComponent(slug)}`);
    if (!response.ok) return undefined;
    const printer = recordFromPrinterResponse(await response.json());
    return printer && isFirmwarePilotStatus(printer.pilot_status) ? printer.pilot_status : undefined;
  } catch {
    return undefined;
  }
}

export async function findPrinterCanon(brand: string, model: string): Promise<PrinterCanonMatch | null> {
  const q = model.trim();
  if (!q) return null;
  try {
    const response = await apiFetch(`/printers?q=${encodeURIComponent(q)}&limit=5`);
    if (!response.ok) return null;
    const data = (await response.json()) as { printers?: PrinterSearchRow[] };
    const rows = data.printers ?? [];
    if (rows.length === 0) return null;

    const modelN = normalize(model);
    const brandN = normalize(brand);
    const match =
      rows.find((row) => normalize(row.model ?? "") === modelN && normalize(row.brand ?? "") === brandN) ??
      rows.find((row) => normalize(row.model ?? "").includes(modelN) || modelN.includes(normalize(row.model ?? ""))) ??
      null;
    if (!match) return null;

    const slug = match.slug ?? null;
    return {
      slug,
      supportLevel: supportLevelOf(match.support_level),
      connectorType: (match.connector_type as PrinterCanonInfo["connectorType"]) ?? null,
      firmwareReady: match.firmware_ready === true,
      firmwarePublic: match.firmware_public === true,
      pilotStatus: slug ? await fetchPilotStatus(slug) : undefined,
    };
  } catch {
    return null;
  }
}
