import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { AuthenticatedUser } from "../domain/auth.ts";
import { AuthSessionService } from "./session.service.ts";

const user: AuthenticatedUser = {
  id: UserId("00000000-0000-4000-8000-000000000001"),
  username: "admin",
};

function responseMock() {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  return {
    response: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe("AuthSessionService cookie domain", () => {
  it("uses a host-only cookie in local development", async () => {
    const service = new AuthSessionService(new ConfigService({ NODE_ENV: "development", JWT_SECRET: "local-test-secret" }));
    const { response, cookie, clearCookie } = responseMock();

    await service.issue(response, user);
    service.clear(response);

    expect(cookie.mock.calls[0]?.[2]).not.toHaveProperty("domain");
    expect(clearCookie.mock.calls[0]?.[1]).not.toHaveProperty("domain");
  });

  it("keeps the default production cookie domain", async () => {
    const service = new AuthSessionService(new ConfigService({ NODE_ENV: "production", JWT_SECRET: "production-test-secret" }));
    const { response, cookie } = responseMock();

    await service.issue(response, user);

    expect(cookie.mock.calls[0]?.[2]).toMatchObject({
      domain: ".3mf.tech",
      secure: true,
    });
  });

  it("honors an explicitly configured deployment domain", async () => {
    const service = new AuthSessionService(
      new ConfigService({
        NODE_ENV: "development",
        JWT_SECRET: "development-test-secret",
        COOKIE_DOMAIN: ".dev.3mf.tech",
      }),
    );
    const { response, cookie } = responseMock();

    await service.issue(response, user);

    expect(cookie.mock.calls[0]?.[2]).toMatchObject({
      domain: ".dev.3mf.tech",
      secure: false,
    });
  });
});
