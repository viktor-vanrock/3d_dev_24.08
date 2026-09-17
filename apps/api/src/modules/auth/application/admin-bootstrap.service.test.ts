import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { verifyPassword } from "../infrastructure/password-hash.ts";
import { AdminBootstrapService } from "./admin-bootstrap.service.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionsService } from "../../permissions/public/index.ts";

const adminId = UserId("00000000-0000-4000-8000-000000000001");
const permissions = { ensureBootstrapDataPermissions: vi.fn().mockResolvedValue({ created: 3, skipped: 0 }) };

describe("AdminBootstrapService", () => {
  it("does nothing when admin credentials are not configured", async () => {
    const repository = { upsertBootstrapAdmin: vi.fn() };
    const logger = { info: vi.fn() };
    const service = new AdminBootstrapService(new ConfigService({}), repository as unknown as AuthRepository, permissions as unknown as PermissionsService, logger as unknown as RuntimeLogger);

    await service.onApplicationBootstrap();

    expect(repository.upsertBootstrapAdmin).not.toHaveBeenCalled();
  });

  it("hashes the configured password and preserves an existing hash by default", async () => {
    const repository = {
      upsertBootstrapAdmin: vi.fn<(username: string, passwordHash: string, updatePassword: boolean) => Promise<typeof adminId>>(() => Promise.resolve(adminId)),
    };
    const logger = { info: vi.fn() };
    const service = new AdminBootstrapService(
      new ConfigService({ ADMIN_USERNAME: "portal.admin", ADMIN_PASSWORD: "long-admin-password" }),
      repository as unknown as AuthRepository,
      permissions as unknown as PermissionsService,
      logger as unknown as RuntimeLogger,
    );

    await service.onApplicationBootstrap();

    expect(repository.upsertBootstrapAdmin).toHaveBeenCalledOnce();
    const [username, passwordHash, updatePassword] = repository.upsertBootstrapAdmin.mock.calls[0]!;
    expect(username).toBe("portal.admin");
    expect(updatePassword).toBe(false);
    await expect(verifyPassword("long-admin-password", passwordHash)).resolves.toBe(true);
  });

  it("passes the explicit password refresh policy to the repository", async () => {
    const repository = {
      upsertBootstrapAdmin: vi.fn<(username: string, passwordHash: string, updatePassword: boolean) => Promise<typeof adminId>>(() => Promise.resolve(adminId)),
    };
    const service = new AdminBootstrapService(
      new ConfigService({
        ADMIN_USERNAME: "portal.admin",
        ADMIN_PASSWORD: "rotated-admin-password",
        ADMIN_PASSWORD_UPDATE_ON_STARTUP: true,
      }),
      repository as unknown as AuthRepository,
      permissions as unknown as PermissionsService,
      { info: vi.fn() } as unknown as RuntimeLogger,
    );

    await service.onApplicationBootstrap();

    expect(repository.upsertBootstrapAdmin).toHaveBeenCalledWith("portal.admin", expect.any(String), true);
  });

  it("uses the development-only eight-character password floor", async () => {
    const repository = {
      upsertBootstrapAdmin: vi.fn<(_username: string, _passwordHash: string, _updatePassword: boolean) => Promise<typeof adminId>>(() => Promise.resolve(adminId)),
    };
    const service = new AdminBootstrapService(
      new ConfigService({
        NODE_ENV: "development",
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "12345678",
        ADMIN_PASSWORD_UPDATE_ON_STARTUP: true,
      }),
      repository as unknown as AuthRepository,
      permissions as unknown as PermissionsService,
      { info: vi.fn() } as unknown as RuntimeLogger,
    );

    await service.onApplicationBootstrap();

    expect(repository.upsertBootstrapAdmin).toHaveBeenCalledWith("admin", expect.any(String), true);
  });

  it("автоматически обеспечивает data permissions bootstrap-администратору", async () => {
    const repository = { upsertBootstrapAdmin: vi.fn().mockResolvedValue(adminId) };
    const provision = { ensureBootstrapDataPermissions: vi.fn().mockResolvedValue({ created: 2, skipped: 1 }) };
    const service = new AdminBootstrapService(
      new ConfigService({ ADMIN_USERNAME: "portal.admin", ADMIN_PASSWORD: "long-admin-password" }),
      repository as unknown as AuthRepository,
      provision as unknown as PermissionsService,
      { info: vi.fn() } as unknown as RuntimeLogger,
    );
    await service.onApplicationBootstrap();
    expect(provision.ensureBootstrapDataPermissions).toHaveBeenCalledWith(adminId);
  });
});
