import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionGrant } from "../domain/permission-grant.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { PermissionsService, type PermissionGrantsRepository } from "./permissions.service.ts";

const userId = UserId("00000000-0000-4000-8000-000000000001");
const grantorId = UserId("00000000-0000-4000-8000-000000000002");

function grant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    userId,
    permission: Permissions.CATALOG_EDIT_ANY,
    scope: {},
    grantedBy: grantorId,
    reason: "Проверка",
    grantedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    ...overrides,
  };
}

function repository(input: { active?: boolean; grants?: readonly PermissionGrant[] } = {}): PermissionGrantsRepository & {
  readonly findActiveGrantsMock: ReturnType<typeof vi.fn>;
  readonly findActivePermissionsMock: ReturnType<typeof vi.fn>;
  readonly ensureBootstrapPermissionsMock: ReturnType<typeof vi.fn>;
} {
  const findActiveGrantsMock = vi.fn().mockResolvedValue(input.grants ?? []);
  const findActivePermissionsMock = vi.fn().mockResolvedValue((input.grants ?? []).map((item) => item.permission));
  const ensureBootstrapPermissionsMock = vi.fn().mockResolvedValue({ created: 0, skipped: 3 });
  return {
    isUserActive: vi.fn().mockResolvedValue(input.active ?? true),
    findActiveGrants: findActiveGrantsMock,
    findActivePermissions: findActivePermissionsMock,
    ensureBootstrapPermissions: ensureBootstrapPermissionsMock,
    createWithAudit: vi.fn(),
    revokeWithAudit: vi.fn(),
    findActiveGrantsMock,
    findActivePermissionsMock,
    ensureBootstrapPermissionsMock,
  };
}

describe("PermissionsService", () => {
  it("отказывает неактивному пользователю до чтения grants", async () => {
    const grants = repository({ active: false, grants: [grant()] });
    const service = new PermissionsService(grants);

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(false);
    expect(grants.findActiveGrantsMock).not.toHaveBeenCalled();
  });

  it("принимает глобальный grant для любого scope", async () => {
    const service = new PermissionsService(repository({ grants: [grant()] }));

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY, { catalog_id: "catalog-1" })).resolves.toBe(true);
  });

  it("сопоставляет все пары ограниченного scope", async () => {
    const service = new PermissionsService(repository({ grants: [grant({ scope: { community_id: "community-1", region: "ru" } })] }));

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY, { community_id: "community-1", region: "ru", extra: true })).resolves.toBe(true);
    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY, { community_id: "community-1" })).resolves.toBe(false);
    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(false);
  });

  it("отказывает для отозванного или истёкшего grant", async () => {
    const service = new PermissionsService(
      repository({
        grants: [
          grant({ revokedAt: new Date("2026-01-02T00:00:00.000Z") }),
          grant({ expiresAt: new Date("2000-01-01T00:00:00.000Z") }),
        ],
      }),
    );

    await expect(service.hasPermission(userId, Permissions.CATALOG_EDIT_ANY)).resolves.toBe(false);
  });

  it("не позволяет выдать разрешение самому себе", async () => {
    const service = new PermissionsService(repository());

    await expect(
      service.grant({ actorId: userId, userId, permission: Permissions.CATALOG_EDIT_ANY, reason: "Самовыдача" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("проецирует только разрешения рабочего пространства данных в стабильные capabilities", async () => {
    const grants = repository({ grants: [grant()] });
    const service = new PermissionsService(grants);

    await expect(service.dataCapabilities(userId)).resolves.toEqual(["data.materials.manage"]);
  });

  it("не объявляет глобальную capability для ограниченного scope", async () => {
    const grants = repository({ grants: [grant({ scope: { catalog_id: "catalog-1" } })] });
    grants.findActivePermissionsMock.mockResolvedValue([]);
    const service = new PermissionsService(grants);

    await expect(service.dataCapabilities(userId)).resolves.toEqual([]);
  });

  it("возвращает пустой список capabilities при ошибке чтения grants", async () => {
    const grants = repository();
    grants.findActivePermissionsMock.mockRejectedValue(new Error("database unavailable"));
    const service = new PermissionsService(grants);

    await expect(service.dataCapabilities(userId)).resolves.toEqual([]);
  });

  it("выдаёт bootstrap-владельцу только permissions рабочего пространства данных", async () => {
    const grants = repository();
    const service = new PermissionsService(grants);
    await expect(service.ensureBootstrapDataPermissions(userId)).resolves.toEqual({ created: 0, skipped: 3 });
    expect(grants.ensureBootstrapPermissionsMock).toHaveBeenCalledWith({
      userId,
      permissions: [Permissions.CATALOG_EDIT_ANY, Permissions.RESEARCH_MANAGE_PRINTERS, Permissions.FEED_MANAGE_NEWS],
      reason: "automatic bootstrap data workspace access",
    });
  });
});
