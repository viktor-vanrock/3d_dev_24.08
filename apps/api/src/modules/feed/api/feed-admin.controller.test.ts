import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";
import { AccessMode } from "../../permissions/domain/access-mode.ts";
import { ACCESS_MODE_KEY, REQUIRED_PERMISSION_KEY } from "../../permissions/guards/permission.guard.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { FeedAdminController } from "./feed-admin.controller.ts";

describe("FeedAdminController", () => {
  it("защищает весь контур feed.manage_news", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, FeedAdminController)).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, FeedAdminController)).toBe(Permissions.FEED_MANAGE_NEWS);
  });

  it("публикует CRUD и явные lifecycle actions под /data/news", () => {
    expect(Reflect.getMetadata(PATH_METADATA, FeedAdminController)).toBe("data/news");
    const prototype = FeedAdminController.prototype;
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.create)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.publish)).toBe(":id/publish");
    expect(Reflect.getMetadata(PATH_METADATA, prototype.hide)).toBe(":id/hide");
  });

  it("передаёт actor в административные изменения", async () => {
    const actorId = "00000000-0000-0000-0000-000000000001";
    const postId = "00000000-0000-0000-0000-000000000002";
    const admin = { update: vi.fn(async () => ({ item: {} })), publish: vi.fn(async () => ({ item: {} })), hide: vi.fn(async () => ({ item: {} })) };
    const controller = new FeedAdminController(admin as never);
    const request = { [SESSION_USER]: { id: actorId } } as RequestWithSession;
    await controller.publish(request, postId);
    expect(admin.publish).toHaveBeenCalledWith(actorId, postId);
  });
});
