import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ACCESS_MODE_KEY, REQUIRED_PERMISSION_KEY } from "../../permissions/guards/permission.guard.ts";
import { AccessMode } from "../../permissions/domain/access-mode.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { PrinterAdminController } from "./printer-admin.controller.ts";

describe("PrinterAdminController", () => {
  it("защищает весь browser-контур правом управления принтерами", () => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, PrinterAdminController)).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, PrinterAdminController)).toBe(Permissions.RESEARCH_MANAGE_PRINTERS);
  });

  it("публикует list, upsert, detail и presign под /data/printers", () => {
    expect(Reflect.getMetadata(PATH_METADATA, PrinterAdminController)).toBe("data/printers");
    const prototype = PrinterAdminController.prototype;
    expect([Reflect.getMetadata(METHOD_METADATA, prototype.list), Reflect.getMetadata(PATH_METADATA, prototype.list)]).toEqual([
      RequestMethod.GET,
      "/",
    ]);
    expect([Reflect.getMetadata(METHOD_METADATA, prototype.upsert), Reflect.getMetadata(PATH_METADATA, prototype.upsert)]).toEqual([
      RequestMethod.POST,
      "/",
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, prototype.detail)).toBe(":slug");
    expect(Reflect.getMetadata(PATH_METADATA, prototype.upload)).toBe("media/presign");
  });
});
