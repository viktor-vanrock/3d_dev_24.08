import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AccessMode } from "../../permissions/domain/access-mode.ts";
import { ACCESS_MODE_KEY } from "../../permissions/guards/permission.guard.ts";
import { CommunityController } from "./community.controller.ts";
const expected = [
  "POST /communities",
  "GET /communities",
  "GET /communities/:id",
  "POST /communities/:id/join",
  "POST /communities/:id/leave",
  "POST /communities/:id/subscribe",
  "DELETE /communities/:id/subscribe",
  "POST /communities/:id/members/:userId/role",
  "POST /communities/:id/bootstrap-owner",
  "GET /communities/:id/feed",
  "POST /communities/:id/threads",
  "GET /communities/:id/threads",
  "GET /threads/:id",
  "POST /threads/:id/posts",
  "POST /threads/:id/vote",
  "POST /posts/:id/vote",
  "POST /posts/:id/attachments",
  "GET /posts/:id/attachments/:attachmentId",
  "POST /threads/:id/accept",
];
describe("CommunityController route inventory", () => {
  it("covers all 19 characterized routes", () => {
    const routes = Object.getOwnPropertyNames(CommunityController.prototype).flatMap((name) => {
      const fn = Object.getOwnPropertyDescriptor(CommunityController.prototype, name)?.value as object | undefined;
      if (!fn) return [];
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
      if (path === undefined || method === undefined) return [];
      return [`${["GET", "POST", "PUT", "DELETE", "PATCH"][method]} /${path}`];
    });
    expect(routes.sort()).toEqual(expected.sort());
  });
  it("opens only the requested community reads at method level", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, CommunityController.prototype.list)).toBe(AccessMode.PUBLIC);
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, CommunityController.prototype.detail)).toBe(AccessMode.PUBLIC);
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, CommunityController.prototype.join)).toBeUndefined();
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, CommunityController)).toBe(AccessMode.USER);
  });
});
