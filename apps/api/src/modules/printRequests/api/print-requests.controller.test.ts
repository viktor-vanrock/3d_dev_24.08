import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import type { PrintRequestsPort, PrintRequestsRateLimitPort } from "../public/index.ts";
import { PrintRequestsController } from "./print-requests.controller.ts";

function route(name: keyof PrintRequestsController) {
  const handler = PrintRequestsController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("PrintRequestsController route inventory", () => {
  it("covers the five authoritative legacy routes", () => {
    expect([route("create"), route("incoming"), route("mine"), route("get"), route("transition")]).toEqual([
      { method: RequestMethod.POST, path: "/" },
      { method: RequestMethod.GET, path: "incoming" },
      { method: RequestMethod.GET, path: "mine" },
      { method: RequestMethod.GET, path: ":id" },
      { method: RequestMethod.PATCH, path: ":id/status" },
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, PrintRequestsController)).toBe("print-requests");
  });

  it("applies the rate-limit gate before create and publishes legacy metadata headers", async () => {
    const create = vi.fn().mockResolvedValue({ id: "request" });
    const printRequests = {
      create,
    } as unknown as PrintRequestsPort;
    const rateLimit: PrintRequestsRateLimitPort = {
      checkCreate: vi.fn().mockResolvedValue({
        limited: false,
        limit: 5,
        remaining: 4,
        reset: 123,
      }),
    };
    const headers = new Map<string, string>();
    const response = {
      setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    } as unknown as Response;
    const request = {
      [SESSION_USER]: {
        id: "11111111-1111-4111-8111-111111111111",
        username: "client",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
    } as RequestWithSession;
    const controller = new PrintRequestsController(printRequests, rateLimit);

    await expect(controller.create(request, { masterId: "master" }, response)).resolves.toEqual({ id: "request" });
    expect(headers).toEqual(
      new Map([
        ["X-RateLimit-Limit", "5"],
        ["X-RateLimit-Remaining", "4"],
        ["X-RateLimit-Reset", "123"],
      ]),
    );
    expect(vi.mocked(rateLimit.checkCreate).mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });

  it("keeps 429 and Retry-After without invoking business creation", async () => {
    const printRequests = {
      create: vi.fn(),
    } as unknown as PrintRequestsPort;
    const rateLimit: PrintRequestsRateLimitPort = {
      checkCreate: vi.fn().mockResolvedValue({
        limited: true,
        retryAfterSeconds: 17,
        limit: 5,
        remaining: 0,
        reset: 123,
      }),
    };
    const response = { setHeader: vi.fn() } as unknown as Response;
    const request = {
      [SESSION_USER]: {
        id: "11111111-1111-4111-8111-111111111111",
        username: "client",
      },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
    } as RequestWithSession;
    const controller = new PrintRequestsController(printRequests, rateLimit);

    const promise = controller.create(request, {}, response);
    await expect(promise).rejects.toMatchObject({ status: 429 });
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "17");
    expect(printRequests.create).not.toHaveBeenCalled();
  });
});
