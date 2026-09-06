import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { PermissionGrantsPgRepository } from "./permission-grants.repository.ts";

describe("PermissionGrantsPgRepository", () => {
  it("читает только неотозванные и неистёкшие grants", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          user_id: "00000000-0000-4000-8000-000000000001",
          permission: Permissions.AUDIT_VIEW_LOG,
          scope: {},
          granted_by: "00000000-0000-4000-8000-000000000002",
          reason: "Проверка",
          granted_at: new Date("2026-01-01T00:00:00.000Z"),
          expires_at: null,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
        },
      ],
    });
    const repository = new PermissionGrantsPgRepository({ query } as never);
    const now = new Date("2026-02-01T00:00:00.000Z");

    const grants = await repository.findActiveGrants({
      userId: UserId("00000000-0000-4000-8000-000000000001"),
      permission: Permissions.AUDIT_VIEW_LOG,
      now,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("revoked_at is null and (expires_at is null or expires_at>$3)"),
      ["00000000-0000-4000-8000-000000000001", Permissions.AUDIT_VIEW_LOG, now],
    );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.userId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("считает активным только пользователя со status active", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await expect(repository.isUserActive(UserId("00000000-0000-4000-8000-000000000001"))).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("identity_read_v1"), ["00000000-0000-4000-8000-000000000001"]);
  });
});
