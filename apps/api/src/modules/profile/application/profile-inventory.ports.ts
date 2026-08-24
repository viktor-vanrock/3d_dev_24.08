import type { UserId } from "../../_kernel/brandedIds.ts";
import type {
  InventoryMaterialDescription,
  PrinterCommandStatusProjection,
  PrinterCompatibilityProjection,
  PrinterLiveProjection,
  PrinterOperatingProjection,
  PrinterQueuedCommandProjection,
  UserPrinterRecord,
} from "../domain/inventory.types.ts";

export const PROFILE_INVENTORY_CATALOG_PORT = Symbol("PROFILE_INVENTORY_CATALOG_PORT");
export const PROFILE_DEVICE_OPERATIONS_PORT = Symbol("PROFILE_DEVICE_OPERATIONS_PORT");
export const PROFILE_MATERIAL_CATALOG_PORT = Symbol("PROFILE_MATERIAL_CATALOG_PORT");
export const PROFILE_ACTIVATION_PRINTERS_PORT = Symbol("PROFILE_ACTIVATION_PRINTERS_PORT");

export interface ProfileMaterialCatalogPort {
  materialExists(materialId: string): Promise<boolean>;
  variantBelongsToMaterial(variantId: string, materialId: string): Promise<boolean>;
  describeMaterial(materialId: string, variantId: string | null): Promise<InventoryMaterialDescription | null>;
}

export interface ProfileInventoryCatalogPort extends ProfileMaterialCatalogPort {
  catalogPrinterExists(printerId: string): Promise<boolean>;
  compatibility(printerId: string, userId: UserId, materialId: string | null, modelId: string | null): Promise<PrinterCompatibilityProjection>;
}

export interface ProfileActivationPrintersPort {
  listPrinters(userId: UserId): Promise<readonly UserPrinterRecord[]>;
}

export interface QueueProfilePrinterCommand {
  readonly command: string;
  readonly slice_id?: string;
  readonly file_name?: string;
}

export interface ProfileDeviceOperationsPort {
  listPrinters(userId: UserId): Promise<readonly UserPrinterRecord[]>;
  createPrinter(
    userId: UserId,
    input: Readonly<{
      printerId: string | null;
      catalogPrinterId: string | null;
      brand: string;
      model: string;
      buildVolume: unknown;
      nozzleMm: number | null;
      kinematics: string | null;
      linkSource: string;
      verified: boolean;
      lanEndpoint: string | null;
      connectionMode: "list" | "managed-local" | "managed-bridge";
    }>,
  ): Promise<UserPrinterRecord>;
  printerOwner(printerId: string): Promise<UserId | null>;
  updatePrinter(printerId: string, userId: UserId, values: Readonly<Record<string, unknown>>): Promise<UserPrinterRecord>;
  deletePrinter(printerId: string, userId: UserId): Promise<boolean>;
  operatingState(printerId: string): Promise<PrinterOperatingProjection>;
  liveState(printerId: string): Promise<PrinterLiveProjection>;
  queueCommand(printerId: string, userId: UserId, idempotencyKey: string, input: QueueProfilePrinterCommand, requestId: string): Promise<PrinterQueuedCommandProjection>;
  commandStatus(printerId: string, commandId: string): Promise<PrinterCommandStatusProjection | null>;
}
