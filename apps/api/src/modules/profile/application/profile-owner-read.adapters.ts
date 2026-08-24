import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { ModelId } from "../../_kernel/brandedIds.ts";
import { CATALOG_READ_PORT, type CatalogReadPort } from "../../catalog/public/index.ts";
import { PRINTER_OWNER_PORT, PRINTER_PROFILE_READ_PORT, type PrinterOwnerPort, type PrinterProfileReadPort } from "../../printers/public/index.ts";
import { MODEL_READ_PORT, type ModelReadPort } from "../../models/public/index.ts";
import type { UserPrinterRecord } from "../domain/inventory.types.ts";
import type { ProfileActivationPrintersPort, ProfileInventoryCatalogPort, ProfileMaterialCatalogPort } from "./profile-inventory.ports.ts";
import { compatCheck, type CompatFilamentInput, type CompatPrinterInput } from "../../models/public/index.ts";

@Injectable()
export class ProfileMaterialCatalogAdapter implements ProfileMaterialCatalogPort {
  constructor(@Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort) {}

  materialExists(materialId: string): Promise<boolean> {
    return this.catalog.materialExists(materialId);
  }

  variantBelongsToMaterial(variantId: string, materialId: string): Promise<boolean> {
    return this.catalog.variantBelongsToMaterial(variantId, materialId);
  }

  describeMaterial(materialId: string, variantId: string | null) {
    return this.catalog.describeMaterial(materialId, variantId);
  }
}

@Injectable()
export class ProfileActivationPrintersAdapter implements ProfileActivationPrintersPort {
  constructor(@Inject(PRINTER_PROFILE_READ_PORT) private readonly printers: PrinterProfileReadPort) {}

  async listPrinters(userId: UserId): Promise<readonly UserPrinterRecord[]> {
    return this.printers.listByUser(userId);
  }
}

@Injectable()
export class ProfileInventoryCatalogAdapter implements ProfileInventoryCatalogPort {
  constructor(
    @Inject(CATALOG_READ_PORT) private readonly catalog: CatalogReadPort,
    @Inject(MODEL_READ_PORT) private readonly models: ModelReadPort,
    @Inject(PRINTER_OWNER_PORT) private readonly printers: PrinterOwnerPort,
  ) {}

  materialExists(materialId: string): Promise<boolean> {
    return this.catalog.materialExists(materialId);
  }

  variantBelongsToMaterial(variantId: string, materialId: string): Promise<boolean> {
    return this.catalog.variantBelongsToMaterial(variantId, materialId);
  }

  describeMaterial(materialId: string, variantId: string | null) {
    return this.catalog.describeMaterial(materialId, variantId);
  }

  catalogPrinterExists(printerId: string): Promise<boolean> {
    return this.printers.catalogPrinterExists(printerId);
  }

  async compatibility(printerId: string, userId: UserId, materialId: string | null, modelId: string | null) {
    const printerRow = await this.printers.findById(printerId);
    if (printerRow === null || printerRow.user_id !== userId) throw new NotFoundException();

    const machine = printerRow.printer_id === null ? null : await this.catalog.machineForSlicer(printerRow.printer_id);
    const specs = machine?.specs && typeof machine.specs === "object" ? (machine.specs as Record<string, unknown>) : {};
    const buildVolume =
      printerRow.build_volume && typeof printerRow.build_volume === "object"
        ? (printerRow.build_volume as { x: number; y: number; z: number })
        : typeof specs.build_volume === "object" && specs.build_volume !== null
          ? (specs.build_volume as { x: number; y: number; z: number })
          : { x: 100000, y: 100000, z: 100000 };
    const printer: CompatPrinterInput = {
      buildVolumeMm: buildVolume,
      nozzleHardened: typeof specs.nozzle_hardened === "boolean" ? specs.nozzle_hardened : undefined,
      maxHotendTempC: typeof specs.max_hotend_temp_c === "number" ? specs.max_hotend_temp_c : undefined,
      chamber: typeof specs.chamber === "string" ? (specs.chamber as CompatPrinterInput["chamber"]) : undefined,
      extruderDrive: typeof specs.extruder_drive === "string" ? (specs.extruder_drive as CompatPrinterInput["extruderDrive"]) : undefined,
      filamentDiameterMm: typeof specs.filament_dia_mm === "number" ? specs.filament_dia_mm : undefined,
    };

    let filament: CompatFilamentInput | undefined;
    if (materialId !== null) {
      const material = await this.catalog.compatibilityMaterial(materialId);
      if (material === null) throw new NotFoundException();
      filament = {
        materialFamily: material.materialType,
        fillType: typeof material.specs.fill_type === "string" ? (material.specs.fill_type as CompatFilamentInput["fillType"]) : undefined,
        needsChamber: material.requiresChamber,
        needsDirectDrive: material.requiresDirectDrive,
        needsDrying: material.requiresDrying,
        extruderTempMaxC: material.defaultExtruderTempC ?? undefined,
      };
    }

    let model: { readonly bboxMm: { readonly x: number; readonly y: number; readonly z: number } } | undefined;
    if (modelId !== null) {
      const id = ModelId(modelId);
      if (!(await this.models.exists(id))) throw new NotFoundException();
      const bboxMm = await this.models.boundingBox(id);
      if (bboxMm !== null) model = { bboxMm };
    }

    return { printer_id: printerId, material_id: materialId, model_id: modelId, ...compatCheck(printer, filament, model) };
  }
}
