import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { isUUID } from "class-validator";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PrinterOperatingProjection, UserPrinterRecord } from "../domain/inventory.types.ts";
import { ActivationRepository } from "../infrastructure/activation.repository.ts";
import {
  PROFILE_DEVICE_OPERATIONS_PORT,
  PROFILE_INVENTORY_CATALOG_PORT,
  type ProfileDeviceOperationsPort,
  type ProfileInventoryCatalogPort,
  type QueueProfilePrinterCommand,
} from "./profile-inventory.ports.ts";

const LINK_SOURCES = ["connector", "popular", "search", "manual", "catalog", "ip"] as const;
const LAN_ENDPOINT = /^(\[[0-9a-f:]+\]|[a-z0-9][a-z0-9.-]*):([0-9]{1,5})$/i;

export interface CreateProfilePrinterInput {
  readonly brand?: string;
  readonly model?: string;
  readonly link_source?: string;
  readonly lan_endpoint?: string;
  readonly printer_id?: string;
  readonly nozzle_mm?: number;
  readonly build_volume?: { readonly x?: number; readonly y?: number; readonly z?: number };
  readonly kinematics?: string;
}

export interface UpdateProfilePrinterInput {
  readonly brand?: string;
  readonly model?: string;
  readonly nozzle_mm?: number;
  readonly build_volume?: { readonly x?: number; readonly y?: number; readonly z?: number };
  readonly kinematics?: string;
  readonly is_primary?: boolean;
}

function normalizeLanEndpoint(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = LAN_ENDPOINT.exec(value.trim());
  if (match === null) return null;
  const port = Number(match[2]);
  const host = match[1]!;
  return port >= 1 && port <= 65535 && host !== "." && !host.includes("..") ? `${host.toLowerCase()}:${port}` : null;
}

@Injectable()
export class ProfilePrintersService {
  constructor(
    @Inject(PROFILE_DEVICE_OPERATIONS_PORT) private readonly devices: ProfileDeviceOperationsPort,
    @Inject(PROFILE_INVENTORY_CATALOG_PORT) private readonly catalog: ProfileInventoryCatalogPort,
    @Inject(ActivationRepository) private readonly activation: ActivationRepository,
  ) {}

  async list(userId: UserId): Promise<{
    readonly printers: readonly (UserPrinterRecord & PrinterOperatingProjection)[];
  }> {
    const printers = await this.devices.listPrinters(userId);
    return { printers: await Promise.all(printers.map(async (printer) => ({ ...printer, ...(await this.devices.operatingState(printer.id)) }))) };
  }

  async create(userId: UserId, input: CreateProfilePrinterInput): Promise<{ readonly printer: UserPrinterRecord }> {
    const brand = input.brand?.trim().slice(0, 64) ?? "";
    const model = input.model?.trim().slice(0, 128) ?? "";
    const linkSource = LINK_SOURCES.includes(input.link_source as (typeof LINK_SOURCES)[number]) ? input.link_source! : null;
    const lanEndpoint = linkSource === "ip" ? normalizeLanEndpoint(input.lan_endpoint) : null;
    if (linkSource === "ip" && lanEndpoint === null) throw new BadRequestException();
    if (linkSource !== "ip" && input.lan_endpoint !== undefined) throw new BadRequestException();
    if (!brand || !model || linkSource === null) throw new BadRequestException();
    let catalogPrinterId: string | null = null;
    if (linkSource === "catalog") {
      if (!input.printer_id || !isUUID(input.printer_id)) throw new BadRequestException();
      if (!(await this.catalog.catalogPrinterExists(input.printer_id))) throw new NotFoundException();
      catalogPrinterId = input.printer_id;
    }
    const printer = await this.devices.createPrinter(userId, {
      printerId: linkSource === "catalog" ? null : (input.printer_id ?? null),
      catalogPrinterId,
      brand,
      model,
      buildVolume: input.build_volume ?? null,
      nozzleMm: input.nozzle_mm !== undefined && input.nozzle_mm > 0 && input.nozzle_mm < 5 ? input.nozzle_mm : null,
      kinematics: input.kinematics?.trim().slice(0, 64) || null,
      linkSource,
      verified: linkSource !== "manual",
      lanEndpoint,
      connectionMode: linkSource === "ip" ? "managed-local" : "list",
    });
    await this.activation.setHasPrinter(userId, true);
    return { printer };
  }

  async update(userId: UserId, id: string, values: UpdateProfilePrinterInput): Promise<{ readonly printer: UserPrinterRecord }> {
    await this.assertOwner(userId, id, false);
    const normalized: Record<string, unknown> = {};
    if (typeof values.brand === "string" && values.brand.trim()) normalized.brand = values.brand.trim().slice(0, 64);
    if (typeof values.model === "string" && values.model.trim()) normalized.model = values.model.trim().slice(0, 128);
    if (typeof values.nozzle_mm === "number" && values.nozzle_mm > 0 && values.nozzle_mm < 5) normalized.nozzle_mm = values.nozzle_mm;
    if (typeof values.build_volume === "object" && values.build_volume !== null) normalized.build_volume = values.build_volume;
    if (typeof values.kinematics === "string") normalized.kinematics = values.kinematics.trim().slice(0, 64) || null;
    if (values.is_primary === true) normalized.is_primary = true;
    if (Object.keys(normalized).length === 0) throw new BadRequestException();
    return { printer: await this.devices.updatePrinter(id, userId, normalized) };
  }

  async delete(userId: UserId, id: string): Promise<{ readonly ok: true }> {
    await this.assertOwner(userId, id, false);
    const hasPrinters = await this.devices.deletePrinter(id, userId);
    if (!hasPrinters) await this.activation.setHasPrinter(userId, false);
    return { ok: true };
  }

  async compatibility(userId: UserId, id: string, materialId: string | null, modelId: string | null) {
    await this.assertOwner(userId, id, false);
    if (materialId !== null && !isUUID(materialId)) throw new BadRequestException();
    if (modelId !== null && !isUUID(modelId)) throw new BadRequestException();
    return this.catalog.compatibility(id, userId, materialId, modelId);
  }

  async live(userId: UserId, id: string) {
    await this.assertOwner(userId, id, true);
    return this.devices.liveState(id);
  }

  async queueCommand(userId: UserId, id: string, idempotencyKey: string | undefined, input: QueueProfilePrinterCommand, requestId: string) {
    await this.assertOwner(userId, id, true);
    if (!idempotencyKey || idempotencyKey.length > 128) throw new BadRequestException();
    if (!input.command) throw new BadRequestException();
    return this.devices.queueCommand(id, userId, idempotencyKey, input, requestId);
  }

  async commandStatus(userId: UserId, id: string, commandId: string) {
    await this.assertOwner(userId, id, true);
    if (!isUUID(commandId)) throw new NotFoundException();
    const command = await this.devices.commandStatus(id, commandId);
    if (command === null) throw new NotFoundException();
    return command;
  }

  private async assertOwner(userId: UserId, id: string, conceal: boolean): Promise<void> {
    const owner = isUUID(id) ? await this.devices.printerOwner(id) : null;
    if (owner === null) throw new NotFoundException();
    if (owner !== userId) {
      if (conceal) throw new NotFoundException();
      throw new ForbiddenException();
    }
  }
}
