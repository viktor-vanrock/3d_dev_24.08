import { Global, Inject, Injectable, Module, NotFoundException } from "@nestjs/common";
import { CatalogModule } from "../../modules/catalog/catalog.module.ts";
import { DevicesModule } from "../../modules/devices/devices.module.ts";
import { DEVICE_PROFILE_OPERATIONS_PORT, type DeviceProfileOperationsPort } from "../../modules/devices/public/index.ts";
import { ModelsModule } from "../../modules/models/models.module.ts";
import { PrintersModule } from "../../modules/printers/printers.module.ts";
import { PRINTER_OWNER_PORT, type PrinterOwnerPort } from "../../modules/printers/public/index.ts";
import type { UserId } from "../../modules/_kernel/brandedIds.ts";
import { ProfileInventoryCatalogAdapter } from "../../modules/profile/public/index.ts";
import {
  PROFILE_DEVICE_OPERATIONS_PORT,
  PROFILE_INVENTORY_CATALOG_PORT,
  type ProfileDeviceOperationsPort,
  type QueueProfilePrinterCommand,
} from "../../modules/profile/public/index.ts";
import type { PrinterBuildVolume } from "../../modules/printers/public/index.ts";

function buildVolume(value: unknown): PrinterBuildVolume | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value;
  const x = "x" in source && typeof source.x === "number" && Number.isFinite(source.x) ? source.x : undefined;
  const y = "y" in source && typeof source.y === "number" && Number.isFinite(source.y) ? source.y : undefined;
  const z = "z" in source && typeof source.z === "number" && Number.isFinite(source.z) ? source.z : undefined;
  return {
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    ...(z === undefined ? {} : { z }),
  };
}
import type {
  PrinterCommandStatusProjection,
  PrinterLiveProjection,
  PrinterOperatingProjection,
  PrinterQueuedCommandProjection,
  UserPrinterRecord,
} from "../../modules/profile/public/index.ts";

@Injectable()
export class ProfileDeviceOperationsAdapter implements ProfileDeviceOperationsPort {
  constructor(
    @Inject(PRINTER_OWNER_PORT) private readonly printers: PrinterOwnerPort,
    @Inject(DEVICE_PROFILE_OPERATIONS_PORT) private readonly devices: DeviceProfileOperationsPort,
  ) {}

  listPrinters(userId: UserId): Promise<readonly UserPrinterRecord[]> {
    return this.printers.listByUser(userId);
  }

  async createPrinter(userId: UserId, input: Parameters<ProfileDeviceOperationsPort["createPrinter"]>[1]) {
    const isPrimary = (await this.printers.countByUser(userId)) === 0;
    return this.printers.create(userId, { ...input, buildVolume: buildVolume(input.buildVolume), isPrimary });
  }

  printerOwner(printerId: string): Promise<UserId | null> {
    return this.printers.findOwner(printerId);
  }

  async updatePrinter(printerId: string, userId: UserId, values: Readonly<Record<string, unknown>>) {
    const updated = await this.printers.update(printerId, userId, values);
    if (updated === null) throw new NotFoundException();
    return updated;
  }

  deletePrinter(printerId: string, userId: UserId): Promise<boolean> {
    return this.printers.delete(printerId, userId);
  }

  async operatingState(printerId: string): Promise<PrinterOperatingProjection> {
    return this.devices.operatingState(printerId);
  }

  async liveState(printerId: string): Promise<PrinterLiveProjection> {
    return this.devices.liveState(printerId);
  }

  async queueCommand(printerId: string, userId: UserId, idempotencyKey: string, input: QueueProfilePrinterCommand, requestId: string): Promise<PrinterQueuedCommandProjection> {
    return this.devices.queueCommand(printerId, userId, idempotencyKey, input, requestId);
  }

  async commandStatus(printerId: string, commandId: string): Promise<PrinterCommandStatusProjection | null> {
    return this.devices.commandStatus(printerId, commandId);
  }
}

@Global()
@Module({
  imports: [CatalogModule, ModelsModule, PrintersModule, DevicesModule],
  providers: [
    ProfileDeviceOperationsAdapter,
    ProfileInventoryCatalogAdapter,
    { provide: PROFILE_DEVICE_OPERATIONS_PORT, useExisting: ProfileDeviceOperationsAdapter },
    { provide: PROFILE_INVENTORY_CATALOG_PORT, useExisting: ProfileInventoryCatalogAdapter },
  ],
  exports: [PROFILE_DEVICE_OPERATIONS_PORT, PROFILE_INVENTORY_CATALOG_PORT],
})
export class ProfilePrintersIntegrationModule {}
