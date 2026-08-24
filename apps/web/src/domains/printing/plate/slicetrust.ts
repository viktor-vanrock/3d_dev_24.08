// Собирает `slice_trust.v1`-материал (apps/api/src/models/sliceTrust.ts, packages/contracts/
// jobs/slicer.ts) для POST /models/:id/slice со стороны браузера — единственный путь без живого
// агента устройства: `fingerprint_source:'agent'` требует bearer-креды самого агента (их у
// вкладки браузера нет), поэтому здесь всегда `fingerprint_source:'declared'` +
// `fingerprint_state:'stock'`, честно промаркированный как "заявлено", не "проверено" (тот же
// смысл, что user_printers.config_fingerprint_source='declared').
//
// `stock_input` — закрытый набор ОПАЩНЫХ идентификаторов (contract's normalizedIdentifier не
// бьётся ни с одним каталогом в БД, чистая функция), собираем best-effort из user_printers —
// `firmware_revision` там не хранится вовсе (нет колонки), поэтому используем честную заглушку
// "unknown" — она искажает только сам fingerprint-хэш (учтено в fingerprint_state:'stock'), не
// какую-либо проверку/гарантию.

export interface SlicePrinterInput {
  id: string;
  brand: string;
  model: string;
  catalogPrinterId?: string | null;
  nozzleMm?: number | null;
  kinematics?: string | null;
  firmwareClass?: string | null;
  buildVolume?: { x: number; y: number; z: number } | null;
}

const IDENTIFIER_SAFE = /[^a-z0-9._/-]+/g;

export function slugifyIdentifier(input: string, fallback: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(IDENTIFIER_SAFE, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return /^[a-z0-9]/.test(slug) ? slug : fallback;
}

export interface StockConfigInput {
  printer_model_id: string;
  stock_profile_id: string;
  nozzle_diameter_um: number;
  build_volume_mm: { x: number; y: number; z: number };
  kinematics: string;
  firmware_family: string;
  firmware_revision: string;
}

const DEFAULT_NOZZLE_MM = 0.4;
const DEFAULT_BUILD_VOLUME_MM = { x: 220, y: 220, z: 250 };
const DEFAULT_KINEMATICS = "cartesian";
const DEFAULT_FIRMWARE_FAMILY = "generic";
const UNKNOWN_FIRMWARE_REVISION = "unknown";

export function buildStockInput(printer: SlicePrinterInput, profileId: string): StockConfigInput {
  const printerModelId = printer.catalogPrinterId
    ?? slugifyIdentifier(`${printer.brand}-${printer.model}`, `printer-${printer.id}`);
  const volume = printer.buildVolume ?? DEFAULT_BUILD_VOLUME_MM;
  return {
    printer_model_id: slugifyIdentifier(printerModelId, `printer-${printer.id}`),
    stock_profile_id: profileId,
    nozzle_diameter_um: Math.round((printer.nozzleMm ?? DEFAULT_NOZZLE_MM) * 1000),
    build_volume_mm: {
      x: Math.max(1, Math.round(volume.x)),
      y: Math.max(1, Math.round(volume.y)),
      z: Math.max(1, Math.round(volume.z)),
    },
    kinematics: slugifyIdentifier(printer.kinematics ?? DEFAULT_KINEMATICS, DEFAULT_KINEMATICS),
    firmware_family: slugifyIdentifier(printer.firmwareClass ?? DEFAULT_FIRMWARE_FAMILY, DEFAULT_FIRMWARE_FAMILY),
    firmware_revision: UNKNOWN_FIRMWARE_REVISION,
  };
}

// `mesh.slicing_queue.compute_slice_key` (ЕДИНСТВЕННЫЙ писатель канонического slice_key) сегодня
// не вызывается из process_one_slice_job — воркер доверяет ключу, подписанному в этом материале
// (задокументированный разрыв, не территория этой карточки чинить). Контракт API требует только
// синтаксически валидный sha256-hex, уникальный на (модель, профиль, филамент, масштаб) для
// корректной идемпотентности/дедупа на этом аккаунте — этого детерминированный хэш ниже
// добивается, даже не будучи побитово тем же, что мог бы посчитать mesh.
export async function computeDeclaredSliceKey(input: {
  modelId: string;
  profileId: string;
  filamentProfileId: string | null;
  scale: number;
}): Promise<string> {
  const text = `${input.modelId}:${input.profileId}:${input.filamentProfileId ?? ""}:${input.scale.toFixed(6)}:web-declared-v1`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface SliceTrustPayload {
  profile_id: string;
  filament_profile_id?: string;
  device_id: string;
  scale: number;
  slice_trust: {
    contract_version: "slice-trust.v1";
    slice_key: string;
    fingerprint_source: "declared";
    fingerprint_state: "stock";
    stock_input: StockConfigInput;
  };
}

export async function buildSliceRequestPayload(input: {
  modelId: string;
  profileId: string;
  filamentProfileId: string | null;
  device: SlicePrinterInput;
  scale?: number;
}): Promise<SliceTrustPayload> {
  const scale = input.scale ?? 1;
  const sliceKey = await computeDeclaredSliceKey({
    modelId: input.modelId,
    profileId: input.profileId,
    filamentProfileId: input.filamentProfileId,
    scale,
  });
  return {
    profile_id: input.profileId,
    ...(input.filamentProfileId ? { filament_profile_id: input.filamentProfileId } : {}),
    device_id: input.device.id,
    scale,
    slice_trust: {
      contract_version: "slice-trust.v1",
      slice_key: sliceKey,
      fingerprint_source: "declared",
      fingerprint_state: "stock",
      stock_input: buildStockInput(input.device, input.profileId),
    },
  };
}
