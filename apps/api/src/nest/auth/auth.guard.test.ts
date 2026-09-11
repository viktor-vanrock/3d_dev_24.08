import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { Public, User } from "../../modules/permissions/public/index.ts";
import { AuthGuard } from "./auth.guard.ts";

@User()
class TestController {
  @Public()
  publicMethod() {}

  protectedMethod() {}
}

@Public()
class PublicController {
  inheritedPublicMethod() {}
}

function context(handler: () => void, controller: object, url: string) {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ method: "GET", originalUrl: url, headers: {} }) }),
  } as never;
}

describe("AuthGuard declarative public access", () => {
  const config = { get: (key: string) => key === "CLOSED_DEV" ? "1" : undefined };

  it("allows method-level @Public() in CLOSED_DEV without reading a session", async () => {
    const readSession = vi.fn();
    const guard = new AuthGuard(new Reflector(), config as never, { readSession } as never);

    await expect(guard.canActivate(context(TestController.prototype.publicMethod, TestController, "/not-in-the-url-matrix"))).resolves.toBe(true);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("allows controller-level @Public() in CLOSED_DEV", async () => {
    const readSession = vi.fn();
    const guard = new AuthGuard(new Reflector(), config as never, { readSession } as never);

    await expect(guard.canActivate(context(PublicController.prototype.inheritedPublicMethod, PublicController, "/also-not-in-the-url-matrix"))).resolves.toBe(true);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("keeps non-public routes session-gated in CLOSED_DEV", async () => {
    const readSession = vi.fn().mockResolvedValue(null);
    const guard = new AuthGuard(new Reflector(), config as never, { readSession } as never);

    await expect(guard.canActivate(context(TestController.prototype.protectedMethod, TestController, "/projects"))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(readSession).toHaveBeenCalledOnce();
  });
});
