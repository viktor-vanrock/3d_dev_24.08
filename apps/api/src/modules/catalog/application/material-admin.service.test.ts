import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { MaterialAdminService, type MaterialAdminRepository } from "./material-admin.service.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");

function repository(): MaterialAdminRepository {
  return {
    options: vi.fn().mockResolvedValue({
      vendors: [{ id: "00000000-0000-4000-8000-000000000003", name: "BASF" }],
      material_types: [{ id: "00000000-0000-4000-8000-000000000004", name: "PLA" }],
    }),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    find: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", version: 1, status: "draft" }),
    create: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", version: 1 }),
    update: vi.fn().mockResolvedValue({ kind: "updated", id: "00000000-0000-4000-8000-000000000002", version: 2 }),
    publish: vi.fn().mockResolvedValue({ kind: "updated", id: "00000000-0000-4000-8000-000000000002", version: 2 }),
    restore: vi.fn().mockResolvedValue({ kind: "updated", id: "00000000-0000-4000-8000-000000000002", version: 2 }),
    archive: vi.fn().mockResolvedValue({ kind: "updated", id: "00000000-0000-4000-8000-000000000002", version: 2 }),
  };
}

describe("MaterialAdminService", () => {
  it("возвращает справочники для формы без технического ввода UUID", async () => {
    const service = new MaterialAdminService(repository());
    await expect(service.options()).resolves.toEqual({
      vendors: [{ id: "00000000-0000-4000-8000-000000000003", name: "BASF" }],
      material_types: [{ id: "00000000-0000-4000-8000-000000000004", name: "PLA" }],
    });
  });

  it("принимает все поддержанные виды материалов", async () => {
    for (const kind of ["filament", "resin", "plywood", "aluminum"] as const) {
      const repo = repository();
      const service = new MaterialAdminService(repo);
      await expect(service.create(actorId, {
        kind,
        slug: `sample-${kind}`,
        name: `Sample ${kind}`,
        vendor_id: "00000000-0000-4000-8000-000000000003",
        material_type_id: "00000000-0000-4000-8000-000000000004",
        specs: {},
      })).resolves.toMatchObject({ version: 1 });
    }
  });

  it("отклоняет неизвестный вид и не обращается к repository", async () => {
    const repo = repository();
    const service = new MaterialAdminService(repo);
    await expect(service.create(actorId, { kind: "vibe", slug: "vibe", name: "Vibe", vendor_id: "x", material_type_id: "y", specs: {} }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("преобразует optimistic-lock conflict и missing в HTTP ошибки", async () => {
    const repo = repository();
    vi.mocked(repo.update).mockResolvedValueOnce({ kind: "conflict" }).mockResolvedValueOnce({ kind: "not_found" });
    const service = new MaterialAdminService(repo);
    const input = { version: 1, name: "Updated" };
    await expect(service.update(actorId, "00000000-0000-4000-8000-000000000002", input)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update(actorId, "00000000-0000-4000-8000-000000000002", input)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("передаёт в repository только метаданные sparse PATCH", async () => {
    const repo = repository();
    const service = new MaterialAdminService(repo);
    await service.update(actorId, "00000000-0000-4000-8000-000000000002", { version: 1, name: "Updated" });
    expect(repo.update).toHaveBeenCalledWith(actorId, "00000000-0000-4000-8000-000000000002", { version: 1, name: "Updated" });
  });

  it("отклоняет status в общем PATCH", async () => {
    const repo = repository();
    const service = new MaterialAdminService(repo);
    await expect(service.update(actorId, "00000000-0000-4000-8000-000000000002", { version: 1, status: "published" }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each(["publish", "archive", "restore"] as const)("различает stale, missing и invalid transition для %s", async (operation) => {
    const repo = repository();
    const service = new MaterialAdminService(repo);
    vi.mocked(repo[operation])
      .mockResolvedValueOnce({ kind: "conflict" })
      .mockResolvedValueOnce({ kind: "not_found" })
      .mockResolvedValueOnce({ kind: "invalid_transition" });
    await expect(service[operation](actorId, "00000000-0000-4000-8000-000000000002", 1)).rejects.toBeInstanceOf(ConflictException);
    await expect(service[operation](actorId, "00000000-0000-4000-8000-000000000002", 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service[operation](actorId, "00000000-0000-4000-8000-000000000002", 1)).rejects.toBeInstanceOf(ConflictException);
  });

  it("восстанавливает архивный материал в draft по ожидаемой версии", async () => {
    const service = new MaterialAdminService(repository());
    await expect(service.restore(actorId, "00000000-0000-4000-8000-000000000002", 1)).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      version: 2,
    });
  });

  it("публикует материал по ожидаемой версии", async () => {
    const service = new MaterialAdminService(repository());
    await expect(service.publish(actorId, "00000000-0000-4000-8000-000000000002", 1)).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      version: 2,
    });
  });

  it("возвращает карточку и архивирует только по ожидаемой версии", async () => {
    const repo = repository();
    const service = new MaterialAdminService(repo);
    await expect(service.find("00000000-0000-4000-8000-000000000002")).resolves.toMatchObject({ version: 1 });
    await expect(service.archive(actorId, "00000000-0000-4000-8000-000000000002", 1)).resolves.toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      version: 2,
    });
  });
});
