import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PrintRequestsRepository } from "../infrastructure/print-requests.repository.ts";
import type { PrintRequestRecord, PrintRequestsProfilePort } from "../public/index.ts";
import { PrintRequestsService } from "./print-requests.service.ts";

const masterId = UserId("11111111-1111-4111-8111-111111111111");
const clientId = UserId("22222222-2222-4222-8222-222222222222");
const strangerId = UserId("33333333-3333-4333-8333-333333333333");
const requestId = "44444444-4444-4444-8444-444444444444";

function row(status: PrintRequestRecord["status"] = "new"): PrintRequestRecord {
  return {
    id: requestId,
    master_id: masterId,
    client_id: clientId,
    model_id: null,
    model_file_id: null,
    material_id: null,
    material_variant_id: null,
    quantity: 1,
    due_date: "2026-08-10",
    client_note: "custom part",
    master_note: null,
    status,
    created_at: new Date("2026-08-05T00:00:00Z"),
    updated_at: new Date("2026-08-05T00:00:00Z"),
  };
}

function setup(overrides: Partial<PrintRequestsRepository> = {}) {
  const repository = {
    create: vi.fn().mockResolvedValue(row()),
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(row()),
    participants: vi.fn().mockResolvedValue({ masterId, clientId }),
    updateStatus: vi.fn().mockResolvedValue(row("discussion")),
    ...overrides,
  } as unknown as PrintRequestsRepository;
  const profiles: PrintRequestsProfilePort = {
    exists: vi.fn().mockResolvedValue(true),
  };
  return {
    repository,
    profiles,
    service: new PrintRequestsService(repository, profiles),
  };
}

describe("PrintRequestsService legacy behavior", () => {
  it("preserves user-existence-only validation without a master-role gate", async () => {
    const { service, profiles, repository } = setup();
    await expect(
      service.create(clientId, {
        masterId,
        dueDate: "2026-08-10",
        clientNote: " custom part ",
      }),
    ).resolves.toEqual(row());
    expect(profiles.exists).toHaveBeenCalledWith(masterId);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        masterId,
        clientId,
        clientNote: "custom part",
      }),
    );
  });

  it("conceals a foreign request as 404", async () => {
    const { service } = setup();
    await expect(service.get(strangerId, requestId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 404 to a foreign transition caller before the master-only 403 gate", async () => {
    const { service } = setup();
    await expect(service.transition(strangerId, requestId, "discussion")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 403 when the client tries to transition their own request", async () => {
    const { service } = setup();
    await expect(service.transition(clientId, requestId, "discussion")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps optimistic transition conflicts at 409", async () => {
    const { service } = setup({
      updateStatus: vi.fn().mockResolvedValue(null),
    });
    await expect(service.transition(masterId, requestId, "discussion")).rejects.toBeInstanceOf(ConflictException);
  });
});
