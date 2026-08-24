import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { isPrintRequestStatus, isValidPrintRequestTransition } from "../domain/print-requests.ts";
import { PrintRequestsRepository } from "../infrastructure/print-requests.repository.ts";
import { PRINT_REQUESTS_PROFILE_PORT, type CreatePrintRequestInput, type PrintRequestRecord, type PrintRequestsPort, type PrintRequestsProfilePort } from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUANTITY = 1000;

function optionalUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

@Injectable()
export class PrintRequestsService implements PrintRequestsPort {
  constructor(
    @Inject(PrintRequestsRepository)
    private readonly repository: PrintRequestsRepository,
    @Inject(PRINT_REQUESTS_PROFILE_PORT)
    private readonly profiles: PrintRequestsProfilePort,
  ) {}

  async create(userId: UserIdType, body: CreatePrintRequestInput): Promise<PrintRequestRecord> {
    if (typeof body.masterId !== "string" || !UUID_RE.test(body.masterId)) {
      throw new BadRequestException();
    }
    const masterId = UserId(body.masterId);
    if (masterId === userId) throw new UnprocessableEntityException();

    const dueDate = typeof body.dueDate === "string" && body.dueDate.length > 0 ? body.dueDate : null;
    if (dueDate === null) throw new BadRequestException();

    const modelId = optionalUuid(body.modelId);
    const modelFileId = optionalUuid(body.modelFileId);
    const clientNote = typeof body.clientNote === "string" && body.clientNote.trim().length > 0 ? body.clientNote.trim() : null;
    if (modelId === null && modelFileId === null && clientNote === null) {
      throw new BadRequestException();
    }

    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new BadRequestException();
    }

    // Legacy intentionally checks user existence only; it does not enforce an is_master role.
    if (!(await this.profiles.exists(masterId))) throw new NotFoundException();
    return this.repository.create({
      masterId,
      clientId: userId,
      modelId,
      modelFileId,
      materialId: optionalUuid(body.materialId),
      materialVariantId: optionalUuid(body.materialVariantId),
      quantity,
      dueDate,
      clientNote,
    });
  }

  incoming(userId: UserIdType, view: unknown) {
    return this.repository.list("master_id", userId, view === "history");
  }

  mine(userId: UserIdType, view: unknown) {
    return this.repository.list("client_id", userId, view === "history");
  }

  async get(userId: UserIdType, rawId: string): Promise<PrintRequestRecord> {
    if (!UUID_RE.test(rawId)) throw new NotFoundException();
    const row = await this.repository.find(rawId);
    if (row === null || (row.master_id !== userId && row.client_id !== userId)) {
      // Existence concealment is intentional: foreign requests are indistinguishable from missing.
      throw new NotFoundException();
    }
    return row;
  }

  async transition(userId: UserIdType, rawId: string, rawStatus: unknown): Promise<PrintRequestRecord> {
    if (!UUID_RE.test(rawId)) throw new NotFoundException();
    if (!isPrintRequestStatus(rawStatus)) throw new BadRequestException();

    const participants = await this.repository.participants(rawId);
    if (participants === null || (participants.masterId !== userId && participants.clientId !== userId)) {
      throw new NotFoundException();
    }
    if (participants.masterId !== userId) throw new ForbiddenException();

    const before = await this.repository.find(rawId);
    if (before === null) throw new NotFoundException();
    if (!isValidPrintRequestTransition(before.status, rawStatus)) {
      throw new ConflictException();
    }
    const after = await this.repository.updateStatus(rawId, before.status, rawStatus);
    if (after !== null) return after;
    await this.repository.find(rawId);
    throw new ConflictException();
  }
}
