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

function repository(input: { active?: boolean; grants?: readonly PermissionGrant[] } = {}): PermissionGrantsRepository & { readonly findActiveGrantsMock: ReturnType<typeof vi.fn> } {
  const findActiveGrantsMock = vi.fn().mockResolvedValue(input.grants ?? []);
  return {
    isUserActive: vi.fn().mockResolvedValue(input.active ?? true),
    findActiveGrants: findActiveGrantsMock,
    createWithAudit: vi.fn(),
    revokeWithAudit: vi.fn(),
    findActiveGrantsMock,
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
});
